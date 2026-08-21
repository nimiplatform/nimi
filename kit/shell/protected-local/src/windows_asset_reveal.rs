use std::{os::windows::ffi::OsStrExt, path::Path, ptr};
use windows_sys::Win32::{
    Foundation::RPC_E_CHANGED_MODE,
    System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
    UI::Shell::{ILFree, SHOpenFolderAndSelectItems, SHParseDisplayName},
};

struct ComApartment(bool);

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

pub(crate) fn reveal_selected_file(path: &Path) -> Result<(), ()> {
    let path_wide = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let initialize_result = unsafe {
        CoInitializeEx(
            ptr::null(),
            COINIT_APARTMENTTHREADED as u32,
        )
    };
    if initialize_result < 0 && initialize_result != RPC_E_CHANGED_MODE {
        return Err(());
    }
    let _apartment = ComApartment(initialize_result >= 0);

    let mut item = ptr::null_mut();
    let parse_result = unsafe {
        SHParseDisplayName(
            path_wide.as_ptr(),
            ptr::null_mut(),
            &mut item,
            0,
            ptr::null_mut(),
        )
    };
    if parse_result < 0 || item.is_null() {
        return Err(());
    }
    let open_result = unsafe { SHOpenFolderAndSelectItems(item, 0, ptr::null(), 0) };
    unsafe { ILFree(item) };
    if open_result < 0 {
        return Err(());
    }
    Ok(())
}
