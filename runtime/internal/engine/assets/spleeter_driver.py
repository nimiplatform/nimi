"""Nimi's fixed Spleeter v1.4.0 checkpoint inference adapter.

Deezer's serialized U-nets remain unchanged. DSP follows the fixed official
c8854001ac8acad34a9bc2bd15f28475541828b1 model builder, including inference
learning phase, zero-prefixed periodic Hann STFT, ratio masks and exact crop.
MIT copyright/permission is retained in spleeter_LICENSE. This adapter has no
Estimator, training, network model provider, arbitrary loader or output pool.
"""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import struct
import sys
import sysconfig

os.environ['CUDA_VISIBLE_DEVICES'] = '-1'
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '2'
PROTOCOL = 'nimi-spleeter-tf-checkpoint/1'
CODE_COMMIT = 'c8854001ac8acad34a9bc2bd15f28475541828b1'
MODEL_RELEASE_COMMIT = '556ef2121492d72398a988af1b38b55176f5973a'

# @nimi-authority: rule.nimi.runtime.ai-provider.spleeter-local-separation
# These fixed bytes were verified from the official checksummed release. No
# filename/extension-only checkpoint inference or ambient model lookup occurs.
MODEL_FILES = {
 2: {'checkpoint': (67, '011c96b970c1f56137037924fe1a0f0851369b0ee6692e120aea798615326f48'),
 'model.data-00000-of-00001': (78614080, '7747f9fd2c782306dbec1504360fbb645a097a48446f23486c3ff9c89bc11788'),
 'model.index': (5244, '55661a09f79c86071fc7077b44b4cf1f01b6d82bbbb83ed94cb68a2f9944e378'),
 'model.meta': (805575, '6e1f6d86a22bb452a58cb20e3de87b416f8a79e626ca223e20f763ab2d21ec95')},
 4: {'checkpoint': (67, '011c96b970c1f56137037924fe1a0f0851369b0ee6692e120aea798615326f48'),
 'model.data-00000-of-00001': (157228152, '3823e0ef50835cca3907c386dc9667a6a9af77b40a20c3ab845a8d6c9592255d'),
 'model.index': (10368, '99ea41b3ef9bfbc6a34520409427af5ba7a883173e57ea25d6c487584b891b18'),
 'model.meta': (1588447, 'f2c2843e3c8c84c737d0ba642fef798d24056f8dbb0b2e2d58a19de55b20034e')},
}

def tensorflow_cpu():
 import tensorflow as tf
 if tf.__version__ != '2.16.1': raise ValueError('TensorFlow version differs from fixed profile')
 tf.config.set_visible_devices([], 'GPU')
 return tf

def probe_environment():
 tf = tensorflow_cpu()
 allocation = tf.constant([1.0])
 if 'CPU' not in allocation.device or float(allocation.numpy()[0]) != 1.0: raise ValueError('CPU allocation failed')
 print(json.dumps({'python_version': platform.python_version(), 'platform_tuple': 'windows/amd64',
 'python_cache_tag': sys.implementation.cache_tag, 'python_soabi': sysconfig.get_config_var('SOABI') or '',
 'python_platform': sys.platform, 'python_machine': platform.machine(), 'python_pointer_bits': struct.calcsize('P')*8,
 'accelerator_plane': 'cpu', 'torch_version': '', 'cuda_abi': '', 'device': 'cpu', 'allocation': 1,
 'tensorflow_version': tf.__version__, 'installed_distributions': sorted(
 {d.metadata['Name'] for d in importlib.metadata.distributions() if d.metadata.get('Name')})}))

def verify_model(root, group):
 if group not in MODEL_FILES: raise ValueError('Spleeter group is unsupported')
 for name, (size, expected) in MODEL_FILES[group].items():
  path = root / name
  if path.is_symlink() or not path.is_file() or path.stat().st_size != size: raise ValueError('Captured model file changed: '+name)
  digest = hashlib.sha256()
  with path.open('rb') as stream:
   for chunk in iter(lambda: stream.read(1024*1024), b''): digest.update(chunk)
  if digest.hexdigest() != expected: raise ValueError('Captured model hash changed: '+name)

def write_float_wav(path, value):
 import numpy as np
 if value.dtype != np.float32 or value.ndim != 2 or value.shape[1] != 2 or not np.isfinite(value).all(): raise ValueError('Stem is not finite stereo float32')
 data = value.astype('<f4', copy=False).tobytes()
 with path.open('xb') as stream:
  stream.write(struct.pack('<4sI4s4sIHHIIHHH4sII4sI', b'RIFF',50+len(data),b'WAVE',b'fmt ',18,3,2,44100,44100*8,8,32,0,b'fact',4,value.shape[0],b'data',len(data)))
  stream.write(data)

def separate(root, group, source, output):
 import numpy as np
 import soundfile as sf
 verify_model(root, group)
 wave, rate = sf.read(source, dtype='float32', always_2d=True)
 n = wave.shape[0]
 if rate != 44100 or wave.shape[1] != 2 or n < 1 or n > 600*44100 or not np.isfinite(wave).all(): raise ValueError('Source is outside canonical 44100Hz stereo bounds')
 if not output.is_dir(): raise ValueError('Output directory must be captured staging')
 stems = ['vocals','accompaniment'] if group == 2 else ['vocals','drums','bass','other']
 tf = tensorflow_cpu()
 graph = tf.Graph()
 with graph.as_default():
  saver = tf.compat.v1.train.import_meta_graph(str(root/'model.meta'), clear_devices=True)
  variables = tf.compat.v1.global_variables()
  reader = tf.train.load_checkpoint(str(root/'model'))
  shapes = reader.get_variable_to_shape_map(); dtypes = reader.get_variable_to_dtype_map()
  if len(variables) != (149 if group == 2 else 297) or len(shapes) != len(variables): raise ValueError('Checkpoint variable set differs')
  for variable in variables:
   name = variable.name.removesuffix(':0')
   if name not in shapes or variable.shape.as_list() != shapes[name] or variable.dtype.base_dtype != dtypes[name]: raise ValueError('Checkpoint variable incompatible: '+name)
  feature = graph.get_tensor_by_name('strided_slice_3:0')
  phase = graph.get_tensor_by_name('keras_learning_phase:0')
  predictions = [graph.get_tensor_by_name(stem+'_spectrogram/mul:0') for stem in stems]
  if feature.shape.as_list() != [None,512,1024,2] or feature.dtype != tf.float32 or phase.dtype != tf.bool: raise ValueError('Captured inference interface differs')
  # Only the checkpoint's restored U-net subgraph is executed. Its obsolete
  # full-waveform graph is not used; the fixed current official DSP is below.
  inp = tf.compat.v1.placeholder(tf.float32,[None,2],name='nimi_source')
  padded = tf.concat([tf.zeros((4096,2)),inp],0)
  hann = lambda length,dtype: tf.signal.hann_window(length,periodic=True,dtype=dtype)
  stft = tf.transpose(tf.signal.stft(tf.transpose(padded),4096,1024,window_fn=hann,pad_end=True),[1,2,0])
  predicted = [tf.compat.v1.placeholder(tf.float32,[None,512,1024,2],name='nimi_prediction_'+stem) for stem in stems]
  denominator = tf.add_n([tf.square(value) for value in predicted])+1e-10
  outputs=[]
  for value in predicted:
   mask=(tf.square(value)+(1e-10/len(stems)))/denominator
   mask=tf.pad(mask,[[0,0],[0,0],[0,1025],[0,0]])
   mask=tf.reshape(mask,[-1,2049,2])[:tf.shape(stft)[0]]
   masked=tf.cast(mask,tf.complex64)*stft
   inverse=tf.signal.inverse_stft(tf.transpose(masked,[2,0,1]),4096,1024,window_fn=hann)*(2.0/3.0)
   outputs.append(tf.transpose(inverse)[4096:4096+tf.shape(inp)[0]])
  config=tf.compat.v1.ConfigProto(device_count={'GPU':0},intra_op_parallelism_threads=2,inter_op_parallelism_threads=1)
  with tf.compat.v1.Session(graph=graph,config=config) as session:
   saver.restore(session,str(root/'model'))
   if len(session.run(tf.compat.v1.report_uninitialized_variables())): raise ValueError('Checkpoint restore left uninitialized variables')
   spectra=session.run(stft,{inp:wave})
   padding=(-spectra.shape[0])%512
   features=np.abs(np.pad(spectra,((0,padding),(0,0),(0,0))).reshape(-1,512,2049,2)[:,:,:1024,:]).astype(np.float32)
   blocks=[[] for _ in stems]
   for block in features:
    values=session.run(predictions,{feature:block[None],phase:False})
    for saved,value in zip(blocks,values):
     if value.shape!=(1,512,1024,2) or value.dtype!=np.float32 or not np.isfinite(value).all(): raise ValueError('Native network result is invalid')
     saved.append(value)
   arrays=session.run(outputs,{inp:wave,**{p:np.concatenate(v) for p,v in zip(predicted,blocks)}})
   for stem,value in zip(stems,arrays):
    if value.shape!=(n,2): raise ValueError('Stem did not preserve full source frame count')
    write_float_wav(output/(stem+'.wav'),value)
 manifest={'protocol':PROTOCOL,'group':group,'sample_rate':44100,'channels':2,'frames':n,'stems':stems}
 path=output/'result.json'
 with path.open('x',encoding='utf-8') as stream: json.dump(manifest,stream,separators=(',',':'))

if __name__ == '__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--model-root',required=True);parser.add_argument('--group',type=int,choices=[2,4],required=True);parser.add_argument('--audio',required=True);parser.add_argument('--output-dir',required=True)
 args=parser.parse_args()
 try: separate(Path(args.model_root),args.group,Path(args.audio),Path(args.output_dir))
 except Exception as error:
  print('spleeter inference failed: '+str(error),file=sys.stderr);sys.exit(1)
