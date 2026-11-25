// @nimi-authority: rule.nimi.runtime.local-compute.desktop-selected-file-import
use std::{
    fs::{self, Metadata, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

use prost::Message;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Channel;

use crate::{
    desktop_unary::DesktopFirstPartyProfile,
    first_party_product::{DesktopFirstPartyProductError, DesktopFirstPartyProductUnaryResponse},
    generated::{
        import_selected_model_file_request::{Frame, Header},
        ImportSelectedModelFileRequest,
    },
};

const CHUNK_BYTES: usize = 1 << 20;

fn unreadable() -> DesktopFirstPartyProductError {
    DesktopFirstPartyProductError::new("model-import-source-unreadable", false)
}

fn same_source(a: &Metadata, b: &Metadata) -> bool {
    a.is_file()
        && b.is_file()
        && (
            a.dev(),
            a.ino(),
            a.len(),
            a.mtime(),
            a.mtime_nsec(),
            a.ctime(),
            a.ctime_nsec(),
        ) == (
            b.dev(),
            b.ino(),
            b.len(),
            b.mtime(),
            b.mtime_nsec(),
            b.ctime(),
            b.ctime_nsec(),
        )
}

fn read_selection(
    path: &Path,
    sender: mpsc::Sender<ImportSelectedModelFileRequest>,
) -> Result<(), DesktopFirstPartyProductError> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|_| path.is_absolute())
        .ok_or_else(unreadable)?;
    let selected = fs::symlink_metadata(path).map_err(|_| unreadable())?;
    let mut input = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| unreadable())?;
    let opened = input.metadata().map_err(|_| unreadable())?;
    if !same_source(&selected, &opened) {
        return Err(unreadable());
    }
    let send = |frame| {
        sender
            .blocking_send(ImportSelectedModelFileRequest { frame: Some(frame) })
            .map_err(|_| DesktopFirstPartyProductError::new("model-import-stream-closed", false))
    };
    send(Frame::Header(Header {
        file_name: name.to_owned(),
        size_bytes: i64::try_from(opened.len()).map_err(|_| unreadable())?,
    }))?;
    let mut remaining = opened.len();
    while remaining > 0 {
        let mut chunk = vec![0; remaining.min(CHUNK_BYTES as u64) as usize];
        input.read_exact(&mut chunk).map_err(|_| unreadable())?;
        remaining -= chunk.len() as u64;
        send(Frame::Data(chunk))?;
    }
    if !same_source(&opened, &input.metadata().map_err(|_| unreadable())?)
        || !same_source(
            &opened,
            &fs::symlink_metadata(path).map_err(|_| unreadable())?,
        )
    {
        return Err(DesktopFirstPartyProductError::new(
            "model-import-source-changed",
            false,
        ));
    }
    send(Frame::Seal(true))
}

pub(crate) async fn import(
    channel: Channel,
    path: PathBuf,
) -> Result<DesktopFirstPartyProductUnaryResponse, DesktopFirstPartyProductError> {
    let (sender, receiver) = mpsc::channel(1);
    let reader = tokio::task::spawn_blocking(move || read_selection(&path, sender));
    let mut request = tonic::Request::new(ReceiverStream::new(receiver));
    request.metadata_mut().insert(
        "x-nimi-protected-first-party-profile",
        tonic::metadata::MetadataValue::from_static(DesktopFirstPartyProfile::Machine.marker()),
    );
    request.metadata_mut().insert(
        "x-nimi-app-id",
        tonic::metadata::MetadataValue::from_static("nimi.desktop"),
    );
    let response = crate::grpc_limits::runtime_local_client(channel)
        .import_selected_model_file(request)
        .await;
    let read_result = reader.await.map_err(|_| unreadable())?;
    if let Err(error) = read_result {
        if error.reason_code() != "model-import-stream-closed" {
            return Err(error);
        }
    }
    let response = response.map_err(|status| {
        if status.code() == tonic::Code::ResourceExhausted
            && status.message() == "model storage is full"
        {
            DesktopFirstPartyProductError::new("model-import-storage-full", false)
        } else {
            crate::desktop_client_stream::map_first_party_status(status)
        }
    })?;
    Ok(DesktopFirstPartyProductUnaryResponse {
        response_bytes: response.into_inner().encode_to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn selection_is_bounded_and_replacement_is_never_sealed() {
        let directory = std::env::temp_dir().join(format!(
            "nimi-selected-file-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&directory).unwrap();
        let selected = directory.join("selected.gguf");
        fs::write(&selected, vec![1; 3 * CHUNK_BYTES]).unwrap();
        let link = directory.join("linked.gguf");
        symlink(&selected, &link).unwrap();
        let (sender, _receiver) = mpsc::channel(1);
        assert!(read_selection(&link, sender).is_err());
        let (sender, mut receiver) = mpsc::channel(1);
        let path = selected.clone();
        let writer = std::thread::spawn(move || read_selection(&path, sender));
        assert!(matches!(
            receiver.blocking_recv().unwrap().frame,
            Some(Frame::Header(_))
        ));
        fs::rename(&selected, directory.join("original.gguf")).unwrap();
        fs::write(&selected, b"replacement").unwrap();
        while let Some(message) = receiver.blocking_recv() {
            assert!(
                matches!(message.frame, Some(Frame::Data(ref data)) if data.len() <= CHUNK_BYTES)
            );
        }
        assert_eq!(
            writer.join().unwrap().unwrap_err().reason_code(),
            "model-import-source-changed"
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
