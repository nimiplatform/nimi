import { Link } from 'react-router-dom';
import { S } from '../../app-shell/page-style.js';

export default function SettingsPage() {
  const sections = [
    { to: '/settings/children', label: '孩子管理', desc: '添加、编辑、删除孩子档案' },
    { to: '/settings/nurture-mode', label: '养育模式', desc: '轻松养 / 均衡养 / 进阶养，可按领域混合配置' },
  ];

  return (
    <div className={S.container} style={{ paddingTop: S.topPad, background: S.bg, minHeight: '100%' }}>
      <h1 className="text-xl font-bold mb-6" style={{ color: S.text }}>设置</h1>

      <div className="grid gap-4">
        {sections.map((s) => (
          <Link key={s.to} to={s.to} className={S.radius + ' block border p-5 hover:border-[#94A533]/30 hover:bg-[#f4f7ea]/30 transition-colors'} style={{ borderColor: S.border }}>
            <h3 className="font-semibold" style={{ color: S.text }}>{s.label}</h3>
            <p className="text-sm mt-1" style={{ color: S.sub }}>{s.desc}</p>
          </Link>
        ))}
        <div className={S.radius + ' border p-5'} style={{ borderColor: S.border }}>
          <h3 className="font-semibold" style={{ color: S.text }}>数据与隐私</h3>
          <p className="text-sm mt-1" style={{ color: S.sub }}>所有数据存储在本地，不上传至云端。符合 PIPL 要求。</p>
        </div>
      </div>
    </div>
  );
}
