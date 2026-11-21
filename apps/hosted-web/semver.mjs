// SemVer 2.0 §11 descending comparator shared by hosted-web publisher and Worker.
export function compareSemverDesc(left, right) {
  const parse = (v) => {
    const withoutBuild = String(v).split('+', 1)[0];
    const dash = withoutBuild.indexOf('-');
    const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
    const pre = dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.');
    const nums = core.split('.').map((part) => Number.parseInt(part, 10));
    return { nums: [nums[0] || 0, nums[1] || 0, nums[2] || 0], pre };
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 3; i += 1) {
    if (a.nums[i] !== b.nums[i]) return b.nums[i] - a.nums[i];
  }
  if (a.pre.length === 0 && b.pre.length === 0) return left < right ? -1 : left > right ? 1 : 0;
  if (a.pre.length === 0) return -1;
  if (b.pre.length === 0) return 1;
  const maxLen = Math.max(a.pre.length, b.pre.length);
  const numeric = /^\d+$/u;
  for (let i = 0; i < maxLen; i += 1) {
    const ai = a.pre[i];
    const bi = b.pre[i];
    if (ai === undefined) return 1;
    if (bi === undefined) return -1;
    if (ai === bi) continue;
    const aNum = numeric.test(ai);
    const bNum = numeric.test(bi);
    if (aNum && bNum) return Number(bi) - Number(ai);
    if (aNum) return 1;
    if (bNum) return -1;
    return ai < bi ? 1 : -1;
  }
  return left < right ? -1 : left > right ? 1 : 0;
}
