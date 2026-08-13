import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { landingLinkDefaults } from '../landing/config/landing-links.js';

export type StaticPageKind = 'home' | 'apps' | 'download' | 'privacy' | 'terms';

type InformationalPageKind = Exclude<StaticPageKind, 'privacy' | 'terms'>;

type PageContent = {
  title: string;
  description: string;
  action: {
    href: string;
    label: string;
  };
};

const INFORMATIONAL_PAGES = {
  home: {
    title: 'Nimi Home',
    description:
      'Nimi Home is the product entry for your account, local AI runtime, agents, apps, worlds, characters, and settings. It is currently hosted by Nimi Desktop.',
    action: {
      href: landingLinkDefaults.desktopDownloadUrl,
      label: 'Read the Desktop guide',
    },
  },
  apps: {
    title: 'Nimi Apps',
    description:
      'Nimi Apps add tools, scenes, and local AI experiences to Nimi. Desktop shows what is available for the current account and local workspace; developers build integrations through the public SDK.',
    action: {
      href: landingLinkDefaults.docsUrl,
      label: 'Read the developer documentation',
    },
  },
  download: {
    title: 'Get Nimi Desktop',
    description:
      'Use the official Desktop guide for current platform requirements, installation instructions, and available release downloads.',
    action: {
      href: landingLinkDefaults.desktopDownloadUrl,
      label: 'Open the Desktop guide',
    },
  },
} satisfies Record<InformationalPageKind, PageContent>;

const LEGAL_DOCUMENTS = {
  privacy: {
    href: '/privacy.html',
    title: 'Privacy Policy',
  },
  terms: {
    href: '/terms.html',
    title: 'Terms of Service',
  },
} satisfies Record<Extract<StaticPageKind, 'privacy' | 'terms'>, { href: string; title: string }>;

function isLegalPage(kind: StaticPageKind): kind is keyof typeof LEGAL_DOCUMENTS {
  return kind === 'privacy' || kind === 'terms';
}

function LegalDocumentRedirect({ document }: { document: (typeof LEGAL_DOCUMENTS)[keyof typeof LEGAL_DOCUMENTS] }) {
  useEffect(() => {
    window.location.replace(document.href);
  }, [document.href]);

  return (
    <main className="web-static-page">
      <section>
        <h1>{document.title}</h1>
        <p>Opening the current Nimi {document.title}.</p>
        <a href={document.href}>Continue to {document.title}</a>
      </section>
    </main>
  );
}

function InformationalPage({ kind }: { kind: InformationalPageKind }) {
  const page = INFORMATIONAL_PAGES[kind];

  useEffect(() => {
    document.title = `${page.title} | Nimi`;
  }, [page.title]);

  return (
    <main className="web-static-page">
      <Link to="/" className="web-wordmark">Nimi</Link>
      <section>
        <h1>{page.title}</h1>
        <p>{page.description}</p>
        <a href={page.action.href}>{page.action.label}</a>
      </section>
      <nav aria-label="Nimi site">
        <Link to="/home">Home</Link>
        <Link to="/apps">Apps</Link>
        <Link to="/download">Download</Link>
        <Link to="/account">Account</Link>
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </nav>
    </main>
  );
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005a
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-web-005e
export function StaticPage({ kind }: { kind: StaticPageKind }) {
  return isLegalPage(kind)
    ? <LegalDocumentRedirect document={LEGAL_DOCUMENTS[kind]} />
    : <InformationalPage kind={kind} />;
}
