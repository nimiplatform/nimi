import template from './native-oauth-result-page.template.html';

export type DesktopOAuthResultPageStatus = 'success' | 'error';
export type DesktopOAuthResultPageLocale = 'en';

export function renderDesktopOAuthResultPage(input: {
  status: DesktopOAuthResultPageStatus;
  locale?: DesktopOAuthResultPageLocale;
  autoCloseMs?: number;
}): string {
  const locale = input.locale || 'en';
  if (locale !== 'en') {
    throw new Error(`Unsupported desktop OAuth result page locale: ${locale}`);
  }

  const autoCloseMs = input.autoCloseMs ?? 3000;
  if (input.status === 'success') {
    return renderTemplate({
      pageTitle: 'OAuth Complete - Nimi',
      bodyBackground: '#ffffff',
      logoAnimationName: 'float',
      logoAnimationDuration: '3s',
      logoAnimationRepeat: 'infinite',
      logoFilter: 'none',
      successIconAnimation: 'scaleIn 0.5s ease-out 0.3s both',
      errorIconAnimation: 'scaleIn 0.5s ease-out',
      statusIconClass: 'success_icon',
      statusIconSvg: `<svg class="checkmark" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      heading: 'Authentication Complete!',
      headingAnimation: 'fadeIn 0.5s ease-out 0.4s both',
      messagePrimary: 'You have successfully signed in to Nimi.',
      messageAnimation: 'fadeIn 0.5s ease-out 0.5s both',
      messageSecondaryBlock: '',
      actionBlock: `<div class="auto_close">You can close this window now<span class="dots"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span></div>`,
      actionAnimation: 'fadeIn 0.5s ease-out 0.7s both',
      autoCloseScript: `<script>setTimeout(function(){window.close();}, ${String(autoCloseMs)});</script>`,
    });
  }

  return renderTemplate({
    pageTitle: 'OAuth Failed - Nimi',
    bodyBackground: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    logoAnimationName: 'shake',
    logoAnimationDuration: '0.8s',
    logoAnimationRepeat: '1',
    logoFilter: 'drop-shadow(0 10px 20px rgba(240, 147, 251, 0.3))',
    successIconAnimation: 'scaleIn 0.5s ease-out 0.3s both',
    errorIconAnimation: 'scaleIn 0.5s ease-out',
    statusIconClass: 'error_icon',
    statusIconSvg: `<svg class="x_mark" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    heading: 'Authentication Failed',
    headingAnimation: 'fadeIn 0.5s ease-out 0.2s both',
    messagePrimary: 'Something went wrong during the sign-in process.',
    messageAnimation: 'fadeIn 0.5s ease-out 0.3s both',
    messageSecondaryBlock: '<p>Please return to the app and try again.</p>',
    actionBlock: '<button class="retry_btn" onclick="window.close()">Close Window</button>',
    actionAnimation: 'fadeIn 0.5s ease-out 0.4s both',
    autoCloseScript: '',
  });
}

function renderTemplate(input: {
  pageTitle: string;
  bodyBackground: string;
  logoAnimationName: string;
  logoAnimationDuration: string;
  logoAnimationRepeat: string;
  logoFilter: string;
  successIconAnimation: string;
  errorIconAnimation: string;
  statusIconClass: string;
  statusIconSvg: string;
  heading: string;
  headingAnimation: string;
  messagePrimary: string;
  messageAnimation: string;
  messageSecondaryBlock: string;
  actionBlock: string;
  actionAnimation: string;
  autoCloseScript: string;
}): string {
  return template
    .replace('__PAGE_TITLE__', input.pageTitle)
    .replace('__BODY_BACKGROUND__', input.bodyBackground)
    .replace('__LOGO_ANIMATION_NAME__', input.logoAnimationName)
    .replace('__LOGO_ANIMATION_DURATION__', input.logoAnimationDuration)
    .replace('__LOGO_ANIMATION_REPEAT__', input.logoAnimationRepeat)
    .replace('__LOGO_FILTER__', input.logoFilter)
    .replace('__SUCCESS_ICON_ANIMATION__', input.successIconAnimation)
    .replace('__ERROR_ICON_ANIMATION__', input.errorIconAnimation)
    .replace('__STATUS_ICON_CLASS__', input.statusIconClass)
    .replace('__STATUS_ICON_SVG__', input.statusIconSvg)
    .replace('__HEADING__', input.heading)
    .replace('__HEADING_ANIMATION__', input.headingAnimation)
    .replace('__MESSAGE_PRIMARY__', input.messagePrimary)
    .replace('__MESSAGE_ANIMATION__', input.messageAnimation)
    .replace('__MESSAGE_SECONDARY_BLOCK__', input.messageSecondaryBlock)
    .replace('__ACTION_BLOCK__', input.actionBlock)
    .replace('__ACTION_ANIMATION__', input.actionAnimation)
    .replace('__AUTO_CLOSE_SCRIPT__', input.autoCloseScript);
}
