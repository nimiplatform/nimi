import { Link } from 'react-router-dom';
import { useAppStore } from '../../app-shell/app-store.js';

export default function ProfilePage() {
  const activeChildId = useAppStore((s) => s.activeChildId);
  const children = useAppStore((s) => s.children);
  const activeChild = children.find((c) => c.childId === activeChildId);

  if (!activeChild) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        请先添加孩子档案
      </div>
    );
  }

  const sections = [
    { to: '/profile/growth', label: '生长曲线', desc: '身高、体重、头围的 WHO 百分位曲线' },
    { to: '/profile/milestones', label: '发育里程碑', desc: '追踪大运动、精细动作、语言等里程碑' },
    { to: '/profile/vaccines', label: '疫苗记录', desc: '疫苗接种记录和接种计划' },
    { to: '/profile/dental', label: '口腔发育', desc: '乳牙萌出、换牙和口腔检查记录' },
    { to: '/profile/allergies', label: '过敏记录', desc: '食物、药物和环境过敏原记录' },
    { to: '/profile/sleep', label: '睡眠记录', desc: '睡眠时长、作息规律和睡眠质量追踪' },
    { to: '/profile/medical-events', label: '就医记录', desc: '门诊、住院和用药记录' },
    { to: '/profile/tanner', label: '青春期发育', desc: 'Tanner 分期和青春期发育追踪' },
    { to: '/profile/fitness', label: '体能测评', desc: '体能测试成绩和运动能力评估' },
  ];

  return (
    <div className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">{activeChild.displayName} 的成长档案</h1>
      <p className="text-gray-500 mb-8">
        {activeChild.gender === 'male' ? '男' : '女'}
        {' · '}
        出生日期 {activeChild.birthDate}
      </p>

      <div className="grid gap-4">
        {sections.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="block rounded-xl border border-gray-200 p-5 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
          >
            <h3 className="font-semibold text-gray-900">{s.label}</h3>
            <p className="text-sm text-gray-500 mt-1">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
