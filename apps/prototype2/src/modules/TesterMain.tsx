import { SCENARIO } from '../scenario/scenario';
import { useSim, type SimWindow } from '../engine/SimContext';

/** Mock of the Tester main surface: workbench + world-tour observer.
 * The world-tour card reacts to shared footprints committed by Desktop —
 * the visible end of the data-sharing flow. */
export function TesterMain({ win }: { win: SimWindow }) {
  const { state } = useSim();
  void win;

  return (
    <div className="mod mod-tester">
      <div className="mod-panel lab-scroll">
        <section className="lab-section">
          <span className="t-overline">世界巡游 · world tour</span>
          <p className="t-caption">按授权只读观察生态共享足迹</p>
          {state.footprints.length === 0 ? (
            <p className="cradle-note dim">暂无足迹。</p>
          ) : (
            <ul className="lab-fp-list">
              {state.footprints.map((f, i) => {
                const w = SCENARIO.worlds.find((x) => x.id === f.worldId);
                return (
                  <li key={i} className="lab-fp" style={{ ['--world-hue' as string]: w?.hue ?? '#45b8d6' }}>
                    <span className="dot" />
                    <b>{w ? `${w.name} ${w.en}` : f.worldId}</b>
                    <span>{f.note}</span>
                    <span className="t-mono">{f.at}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lab-section">
          <span className="t-overline">套件画廊 · kit gallery</span>
          <div className="lab-chips">
            <span className="chip">Surface</span>
            <span className="chip">OverlayShell</span>
            <span className="chip">StatusBadge</span>
            <span className="chip">SidebarShell</span>
            <span className="chip">DataList</span>
            <span className="chip">SegmentedControl</span>
          </div>
        </section>

        <section className="lab-section">
          <span className="t-overline">验收探针 · acceptance</span>
          <div className="lab-chips">
            <span className="chip" data-tone="warning">electron acceptance probe · 模拟中不可用</span>
            <span className="chip" data-tone="warning">shell acceptance capture · 模拟中不可用</span>
          </div>
          <p className="cradle-note dim">探针属于真实宿主能力；本模拟不伪造它们的成功。</p>
        </section>
      </div>
    </div>
  );
}
