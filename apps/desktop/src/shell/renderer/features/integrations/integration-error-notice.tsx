import { useTranslation } from 'react-i18next';

export function IntegrationErrorNotice({ message, code }: { message: string; code?: string }) {
  const { t } = useTranslation();
  return (
    <>
      <p>{message}</p>
      {code === 'INTEGRATION_TELEGRAM_WEBHOOK_CONFLICT' ? (
        <details className="mt-2 text-sm leading-relaxed">
          <summary className="cursor-pointer rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]">
            {t('Integrations.telegramWebhookHelp')}
          </summary>
          <div className="mt-3 space-y-4">
            <div>
              <p className="font-medium">{t('Integrations.telegramWebhookNewBotTitle')}</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>
                  {t('Integrations.telegramWebhookNewBotCreate')}{' '}
                  <a
                    className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                    href="https://t.me/BotFather"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('Integrations.telegramWebhookOpenBotFather')}
                  </a>
                </li>
                <li>{t('Integrations.telegramWebhookNewBotConnect')}</li>
              </ol>
            </div>
            <div>
              <p className="font-medium">{t('Integrations.telegramWebhookExistingBotTitle')}</p>
              <p className="mt-2">{t('Integrations.telegramWebhookExistingBotImpact')}</p>
              <ol className="mt-2 list-decimal space-y-2 pl-5">
                <li>{t('Integrations.telegramWebhookExistingBotDisable')}</li>
                <li>{t('Integrations.telegramWebhookExistingBotReconnect')}</li>
              </ol>
            </div>
          </div>
        </details>
      ) : null}
    </>
  );
}
