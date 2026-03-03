import type { LandingContent } from '../content/landing-content.js';
import { SectionHeader } from './section-header.js';

export type OpenSourceSectionProps = {
  content: LandingContent['openSource'];
};

export function OpenSourceSection(props: OpenSourceSectionProps) {
  return (
    <section className="section-pad">
      <div className="container-nimi">
        <SectionHeader title={props.content.title} subtitle={props.content.subtitle} />
        <div className="reveal mt-10 overflow-x-auto rounded-2xl border border-white/10 bg-slate-950/55">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm text-slate-100">
            <thead className="bg-slate-950/65 text-xs uppercase tracking-[0.18em] text-mint-200">
              <tr>
                <th className="px-4 py-3 font-semibold">{props.content.columns.component}</th>
                <th className="px-4 py-3 font-semibold">{props.content.columns.path}</th>
                <th className="px-4 py-3 font-semibold">{props.content.columns.license}</th>
                <th className="px-4 py-3 font-semibold">{props.content.columns.mode}</th>
              </tr>
            </thead>
            <tbody>
              {props.content.rows.map((row) => (
                <tr key={`${row.component}:${row.path}`} className="border-t border-white/10">
                  <td className="px-4 py-3 font-medium text-white">{row.component}</td>
                  <td className="px-4 py-3 font-mono text-cyan-100">{row.path}</td>
                  <td className="px-4 py-3 text-slate-200">{row.license}</td>
                  <td className="px-4 py-3 text-slate-200">{row.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="reveal mt-4 text-sm text-slate-300/85">{props.content.note}</p>
      </div>
    </section>
  );
}
