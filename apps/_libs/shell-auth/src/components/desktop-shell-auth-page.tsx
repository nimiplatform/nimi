import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import type {
  ShellAuthDesktopBrowserAuth,
  ShellAuthSession,
  ShellAuthTestIds,
} from '../types/auth-types.js';
import { ShellAuthPage } from './shell-auth-page.js';
import { DesktopParticleBackgroundLight } from './desktop-particle-background-light.js';

function DesktopAuthLogoMark() {
  return (
    <svg
      viewBox="184 313 380 380"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-full w-full"
    >
      <path
        d="M422.113 481.686C430.279 480.015 446.572 482.447 454.744 485.044C474.442 491.419 490.788 505.375 500.17 523.835C510.86 544.83 507.885 568.74 508.02 591.755C508.09 603.355 509.375 625.185 506.61 635.715C501.86 653.805 472.816 653.475 468.884 633.79C467.447 626.595 467.732 621.445 467.725 614.045L467.799 576.085C467.82 569.98 468.13 559.645 467.414 553.935C466.877 549.735 465.639 545.65 463.753 541.855C458.426 531.205 450.147 526.415 439.371 522.855C418.86 518.45 397.129 530.92 393.886 552.465C392.732 560.135 393.355 570.905 393.38 578.865L393.501 616.235C393.539 630.155 393.938 646.325 376.066 648.96C370.79 649.76 365.414 648.385 361.173 645.145C356.643 641.695 353.662 636.02 353.392 630.495C352.832 619.04 352.815 605.915 353.063 594.415C353.741 563.005 348.149 536.885 369.342 510.415C382.862 493.529 400.96 484.259 422.113 481.686Z"
        fill="#1E377A"
      />
      <path
        d="M366.78 358.693C387.936 354.799 413.753 366.464 428.697 381.272C455.942 408.267 451.554 439.24 451.453 474.569C436.213 470.888 426.427 471.087 410.973 473.849C410.952 464.297 411.502 434.843 409.743 426.92C408.674 422.173 406.671 417.686 403.851 413.72C397.957 405.5 389.408 400.845 379.57 399.148C361.515 396.503 343.387 406.617 337.892 424.366C335.266 432.85 335.94 441.424 335.986 450.205C336.03 458.147 336.033 466.089 335.995 474.031C321.154 470.317 310.245 471.335 295.554 474.351L295.477 447.484C295.438 423.32 296.416 407.895 312.579 387.553C325.927 370.754 345.517 360.925 366.78 358.693Z"
        fill="#1F9BAB"
      />
      <path
        d="M308.576 481.688C328.835 479.184 350.932 486.027 366.299 499.41C355.659 511.25 350.596 521.465 346.144 536.55C345.187 535.31 344.164 534.12 343.08 532.99C336.399 526.07 327.253 522.07 317.637 521.865C306.582 521.69 297.979 525.26 289.97 532.86C276.865 545.29 279.364 561.995 279.416 578.375L279.48 617.375C279.575 625.65 280.237 633.975 275.159 641.04C272.042 645.34 267.339 648.215 262.092 649.035C250.188 650.875 239.87 642.685 239.051 630.68C237.974 614.88 239.03 598.35 238.633 582.555C237.997 557.28 237.564 532.345 254.522 511.645C268.926 493.583 285.701 484.6 308.576 481.688Z"
        fill="#1D3D7C"
      />
    </svg>
  );
}

export type DesktopShellAuthPageProps = {
  adapter: AuthPlatformAdapter;
  session: ShellAuthSession;
  footer?: ReactNode;
  desktopBrowserAuth?: ShellAuthDesktopBrowserAuth;
  testIds?: ShellAuthTestIds;
};

export function DesktopShellAuthPage(props: DesktopShellAuthPageProps) {
  const { t } = useTranslation();
  const { adapter, session, footer, desktopBrowserAuth, testIds } = props;
  const mode = session.mode;

  return (
    <ShellAuthPage
      adapter={adapter}
      session={session}
      branding={{
        networkLabel: t('Auth.nimiNetwork'),
        logo: <DesktopAuthLogoMark />,
        logoAltText: 'Nimi Logo',
      }}
      appearance={{
        theme: 'desktop',
        shellClassName: 'absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none p-0',
        contentClassName: mode === 'embedded' ? 'w-full max-w-[440px] px-6 gap-6' : '',
        footerPlacement: 'inside-content',
      }}
      background={({ isLogoHovered }) => (
        <DesktopParticleBackgroundLight
          isLogoHovered={isLogoHovered}
          profile={mode === 'embedded' ? 'web' : 'desktop'}
        />
      )}
      footer={mode === 'embedded' ? footer : undefined}
      desktopBrowserAuth={
        mode === 'desktop-browser' && desktopBrowserAuth
          ? {
              ...desktopBrowserAuth,
              hintVisibility: desktopBrowserAuth.hintVisibility || 'hover-or-status',
            }
          : undefined
      }
      copy={{
        desktopLogoHintText: t('Auth.desktopAuthFailed'),
        desktopAuthOpenMessage: '已打开浏览器，请在网页完成授权登录。',
        desktopAuthSuccessMessage: '网页登录授权成功，已登录。',
      }}
      testIds={testIds}
    />
  );
}
