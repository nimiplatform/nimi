import unittest
import numpy as np
from types import SimpleNamespace
from face_swap import FaceSwapError, HyperSwapONNX, normalize_hyperswap_identity, prepare_hyperswap_crop, decode_hyperswap_pixels


class ControlledTensorSession:
    """Arithmetic fixture only; never presented as model or App acceptance."""
    def __init__(self):
        self.feed = None
    def get_inputs(self):
        return [SimpleNamespace(name=n, type='tensor(float)', shape=s) for n,s in
                [('source',[1,512]),('target',[1,3,256,256])]]
    def get_outputs(self):
        return [SimpleNamespace(name=n, type='tensor(float)', shape=s) for n,s in
                [('output',[1,3,256,256]),('mask',[1,1,256,256])]]
    def run(self, names, feed):
        self.feed = feed
        self.names = names
        result = np.zeros((1,3,256,256),np.float32)
        result[:,0] = 1
        result[:,2] = -1
        return [result]


class HyperSwapArithmeticTests(unittest.TestCase):
    def test_normalized_identity_rgb_range_and_inverse_pixels(self):
        session = ControlledTensorSession()
        model = HyperSwapONNX(session)
        source = np.array([3.,4.]+[0.]*510,np.float32)
        image = np.zeros((256,256,3),np.uint8)
        image[:,:,0]=255
        prediction = session.run(['output'], {'source':normalize_hyperswap_identity(source), 'target':prepare_hyperswap_crop(image)})[0]
        tile = decode_hyperswap_pixels(prediction)
        np.testing.assert_allclose(session.feed['source'][0,:2],[.6,.8])
        self.assertEqual(session.feed['target'].dtype,np.float32)
        self.assertEqual(session.names,['output'])
        self.assertEqual(tuple(tile.shape),(256,256,3))
        np.testing.assert_array_equal(tile[128,128],[0,127,255])
        self.assertAlmostEqual(float(session.feed['target'][0,2,128,128]),1.,places=5)

    def test_zero_identity_and_wrong_graph_are_not_success(self):
        model=HyperSwapONNX(ControlledTensorSession())
        with self.assertRaises(FaceSwapError):
            normalize_hyperswap_identity(np.zeros(512,np.float32))
        class WrongGraph(ControlledTensorSession):
            def get_outputs(self):return super().get_outputs()[:1]
        with self.assertRaises(FaceSwapError):HyperSwapONNX(WrongGraph())


if __name__=='__main__':unittest.main()
