import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';

// The protocol returns a verification link, not an image resource. Encode it
// locally so Home never needs a third-party QR generation service.
export function IntegrationSetupQr({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [image, setImage] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setImage('');
    setFailed(false);
    void QRCode.toDataURL(value, { width: 256, margin: 2, errorCorrectionLevel: 'M' })
      .then((result) => {
        if (live) setImage(result);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => { live = false; };
  }, [value]);

  if (image) {
    return <img className="mt-3 h-64 w-64 rounded-lg" src={image} alt={label} />;
  }

  if (failed) {
    return (
      <div
        role="status"
        className="mt-3 flex h-64 w-64 flex-col items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4 text-center text-xs leading-5 text-[var(--nimi-text-secondary)]"
      >
        {t('Integrations.qrUnavailableFallback', {
          defaultValue: 'Could not render the QR code. Use the verification link below to continue.',
        })}
      </div>
    );
  }

  return (
    <div
      aria-busy="true"
      aria-label={label}
      className="mt-3 h-64 w-64 animate-pulse motion-reduce:animate-none rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]"
    />
  );
}
