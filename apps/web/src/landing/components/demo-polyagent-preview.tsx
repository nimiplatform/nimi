import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import { Activity, BookOpen, Bot, Layers3, Pause, Play, Settings2, Wallet } from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { PreviewHeading, PreviewNav, RemainingPreview } from './demo-remaining-shared.js';

/** PolyAgent's teal operational desk. All markets and amounts below are fictional paper examples. */
export function DemoPolyagentPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('desk');
  const [running, setRunning] = useState(false);
  const [budget, setBudget] = useState(() => pData('100'));
  const [selected, setSelected] = useState(0);
  const nav = [
    { id: 'desk', label: '工作台', Icon: Activity },
    { id: 'positions', label: '持仓', Icon: Wallet },
    { id: 'orders', label: '订单', Icon: Layers3 },
    { id: 'decisions', label: '研究与决定', Icon: BookOpen },
    { id: 'settings', label: '运行设置', Icon: Settings2 },
  ];
  const markets = [
    {
      title: '示例市场 A · 展览会在计划日期开幕吗？',
      price: '0.72',
      volume: '1,200',
      status: '观察中',
    },
    {
      title: '示例市场 B · 社区项目会按期完成吗？',
      price: '0.64',
      volume: '860',
      status: '等待检查',
    },
    {
      title: '示例市场 C · 新版本会在本月发布吗？',
      price: '0.81',
      volume: '2,100',
      status: '约束未满足',
    },
  ];
  return (
    <RemainingPreview content={content} kind="polyagent">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={setView}
          footer={
            <>
              <Bot size={25} />
              <strong>{pText('示例研究助理')}</strong>
              <small>{pText('模拟工作区 · 实验版')}</small>
            </>
          }
        />
        <main className="rp-main rp-page">
          <PreviewHeading
            title={pText(nav.find((x) => x.id === view)!.label)}
            description={pText('把市场变化，变成有边界的行动。')}
          >
            <span className="pa-demo-mode">{pText('虚构数据 · 模拟交易')}</span>
            <PreviewButton primary onClick={() => setRunning(!running)}>
              {running ? <Pause size={15} /> : <Play size={15} />}
              {pText(' ')}
              {pText(running ? pText('暂停示例') : pText('运行示例'))}
            </PreviewButton>
          </PreviewHeading>
          {view === 'settings' ? (
            <section className="pa-demo-settings">
              <h2>{pText('先确定边界，再开始工作')}</h2>
              <label>
                {pText('模拟资金上限')}
                <input
                  type="number"
                  min="0"
                  value={budget}
                  onChange={(e) => {
                    setBudget(e.target.value);
                  }}
                />
              </label>
              <label>
                {pText('研究助理')}
                <select defaultValue="示例研究助理">
                  <option value={'示例研究助理'}>{pText('示例研究助理')}</option>
                </select>
              </label>
              <label>
                {pText('运行方式')}
                <select value="paper" onChange={() => {}}>
                  <option value="paper">{pText('静态模拟 · 无交易连接')}</option>
                </select>
              </label>
              <p>{pText('此预览不提供真实账户、私钥、钱包或订单签名入口。')}</p>
              <PreviewButton onClick={() => setView('desk')}>{pText('返回工作台')}</PreviewButton>
            </section>
          ) : view === 'desk' ? (
            <>
              <div className="pa-demo-status">
                <span className={running ? 'pa-demo-running' : ''} />
                <div>
                  <strong>
                    {pText(running ? pText('正在展示示例运行状态') : pText('示例已暂停'))}
                  </strong>
                  <p>{pText('运行状态只在当前页面切换，不会启动交易或计划任务。')}</p>
                </div>
              </div>
              <div className="pa-demo-summary">
                <div>
                  <small>{pText('模拟可用资金')}</small>
                  <strong>
                    {pText(Number(budget || 0).toFixed(2))} <span>{pText('USD')}</span>
                  </strong>
                </div>
                <div>
                  <small>{pText('模拟持仓')}</small>
                  <strong>
                    {pText('1 ')}
                    <span>{pText('条记录')}</span>
                  </strong>
                </div>
                <div>
                  <small>{pText('观察列表')}</small>
                  <strong>
                    {pText('3 ')}
                    <span>{pText('个虚构市场')}</span>
                  </strong>
                </div>
              </div>
              <section className="pa-demo-markets">
                <div className="rp-section-heading">
                  <h2>{pText('候选市场')}</h2>
                  <span>{pText('示例快照')}</span>
                </div>
                {markets.map((m, i) => (
                  <button
                    type="button"
                    key={m.title}
                    aria-pressed={selected === i}
                    onClick={() => setSelected(i)}
                  >
                    <div>
                      <h3>{pText(m.title)}</h3>
                      <p>
                        {pText('纸面价格 ')}
                        {pText(m.price)} {pText(' · 示例成交量 ')}
                        {pText(m.volume)}
                      </p>
                    </div>
                    <span>{pText(m.status)}</span>
                  </button>
                ))}
              </section>
              <section className="pa-demo-decision">
                <h2>{pText(markets[selected]!.title)}</h2>
                <p>
                  {pText(
                    '示例研究记录：核对市场规则、到期时间与流动性。当前没有真实市场数据，不产生交易建议。',
                  )}
                </p>
                <PreviewButton onClick={() => setView('decisions')}>
                  {pText('查看示例研究记录')}
                </PreviewButton>
              </section>
            </>
          ) : view === 'decisions' ? (
            <section className="pa-demo-decision">
              <h2>{pText('保留当时看到的事实与决定')}</h2>
              <ol>
                <li>{pText('读取虚构市场快照，确认记录时间。')}</li>
                <li>{pText('核对策略条件、资金上限和单笔约束。')}</li>
                <li>{pText('示例决定：继续观察，不执行真实操作。')}</li>
              </ol>
              <p>{pText('价格是市场报价，不是获利保证；这里的数值仅用于界面演示。')}</p>
            </section>
          ) : (
            <section className="pa-demo-ledger">
              <h2>{pText(view === 'orders' ? pText('订单与成交') : pText('当前持仓'))}</h2>
              <div className="rp-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{pText('市场')}</th>
                      <th>{pText('方向')}</th>
                      <th>{pText('数量')}</th>
                      <th>{pText('状态')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{pText('示例市场 A')}</td>
                      <td>{pText('Yes · 示例')}</td>
                      <td>{pText('10')}</td>
                      <td>{pText('模拟记录')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>{pText('这份预设账本不代表交易所订单或真实持仓。')}</p>
            </section>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
