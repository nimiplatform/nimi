import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// The protocol returns a verification link, not an image resource. Encode it
// locally so Home never needs a third-party QR generation service.
export function IntegrationSetupQr({ value, label }: { value: string; label: string }) {
  const [image, setImage] = useState('');
  useEffect(() => {
    let live = true;
    setImage('');
    void QRCode.toDataURL(value, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      .then(result => { if (live) setImage(result); }).catch(() => {});
    return () => { live = false; };
  }, [value]);
  return image ? <img className="mt-3 h-64 w-64 rounded-lg" src={image} alt={label} /> : null;
}
