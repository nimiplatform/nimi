import { Link } from 'react-router-dom';

export default function SettingsPage() {
  const sections = [
    { to: '/settings/children', label: '孩子管理', desc: '添加、编辑、删除孩子档案' },
    { to: '/settings/nurture-mode', label: '养育模式', desc: '轻松养 / 均衡养 / 进阶养，可按领域混合配置' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">设置</h1>

      <div className="grid gap-4">
        {sections.map((s) => (
          <Link key={s.to} to={s.to} className="block rounded-lg border border-gray-200 p-5 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
            <h3 className="font-semibold">{s.label}</h3>
            <p className="text-sm text-gray-500 mt-1">{s.desc}</p>
          </Link>
        ))}
        <div className="rounded-lg border border-gray-200 p-5">
          <h3 className="font-semibold">数据与隐私</h3>
          <p className="text-sm text-gray-500 mt-1">所有数据存储在本地，不上传至云端。符合 PIPL 要求。</p>
        </div>
      </div>
    </div>
  );
}
