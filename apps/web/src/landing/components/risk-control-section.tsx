import { ArrowDownUp, ArrowUpRight, ShieldCheck } from 'lucide-react';
import type { LandingContent } from '../content/landing-content.js';
import type { LandingLinks } from '../config/landing-links.js';

// @nimi-authority: rule.nimi.runtime.ai-provider.text-content-boundaries
export function RiskControlSection({ content, links }: {
  content: LandingContent['riskControl'];
  links: LandingLinks;
}) {
  return (
    <section id="risk-control" aria-labelledby="risk-control-title" className="screen-section bg-[#f4fbfa] py-24">
      <div className="container-nimi">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div>
            <h2 id="risk-control-title" className="max-w-xl text-balance text-3xl font-semibold tracking-tight text-slate-900 md:text-4xl">
              {content.title}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-8 text-slate-700">{content.description}</p>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-700">{content.benefit}</p>
            <p className="mt-7 text-sm font-medium text-emerald-800">{content.availability}</p>
            <a className="mt-4 inline-flex items-center gap-2 rounded-control-sm py-2 text-base font-semibold text-slate-900 underline decoration-emerald-400 underline-offset-4 transition hover:text-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700" href={links.riskControlUrl}>
              {content.cta}
              <ArrowUpRight size={18} aria-hidden="true" />
            </a>
          </div>
          <figure aria-label={content.diagram.label} className="m-0 min-w-0">
            <p className="text-center text-sm font-semibold text-slate-700">{content.diagram.apps}</p>
            <ul className="mt-3 grid grid-cols-3 gap-3 text-center">
              {content.diagram.activities.map((activity) => (
                <li key={activity} className="rounded-control border border-emerald-200 bg-white px-2 py-3 text-sm font-medium text-slate-800">{activity}</li>
              ))}
            </ul>
            <ArrowDownUp className="mx-auto my-4 text-emerald-700" size={24} aria-hidden="true" />
            <div className="rounded-window border border-emerald-300 bg-white px-5 py-7 sm:px-8">
              <div className="flex items-center justify-center gap-3">
                <ShieldCheck size={28} className="shrink-0 text-emerald-700" aria-hidden="true" />
                <p className="text-xl font-semibold tracking-tight text-slate-900">Nimi Runtime</p>
              </div>
              <p className="mt-2 text-center text-sm leading-6 text-slate-600">{content.diagram.runtime}</p>
              <ul className="mt-6 grid grid-cols-3 gap-2 border-t border-slate-200 pt-5 text-center text-sm font-medium text-slate-800">
                {content.diagram.checks.map((check) => <li key={check}>{check}</li>)}
              </ul>
            </div>
            <ArrowDownUp className="mx-auto my-4 text-emerald-700" size={24} aria-hidden="true" />
            <ul className="grid grid-cols-2 gap-3 text-center">
              {content.diagram.routes.map((route) => (
                <li key={route} className="rounded-control border border-emerald-200 px-3 py-3 text-sm font-medium text-slate-800">{route}</li>
              ))}
            </ul>
            <figcaption className="mt-4 text-center text-sm leading-6 text-slate-600">{content.diagram.caption}</figcaption>
          </figure>
        </div>
        <div className="mt-10 border-t border-emerald-200 pt-5 text-sm leading-6 text-slate-600">
          <p className="font-medium text-slate-800">{content.scope}</p>
          <p className="mt-1">{content.limit}</p>
        </div>
      </div>
    </section>
  );
}
