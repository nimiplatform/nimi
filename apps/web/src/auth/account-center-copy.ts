import { useTranslation } from 'react-i18next';
import { useCallback } from 'react';
import { asNimiError } from '@nimiplatform/sdk/types';

export const accountCenterCopy = {
  accountUnavailable: ['Your account is temporarily unavailable', '暂时无法打开账号'],
  sending: ['Sending…', '正在发送…'],
  keepEditing: ['Keep editing', '继续编辑'],
  discardChanges: ['Discard changes', '放弃更改'],
  userNotFound: [
    'No account found. Check the exact username and try again.',
    '没有找到该用户，请核对完整用户名后重试。',
  ],
  requestDenied: [
    'This person is not accepting this request. Your request was not sent.',
    '目前无法向对方发起申请，本次申请未发送。',
  ],
  sessionExpired: [
    'Your sign-in has expired. Sign in again before continuing.',
    '登录已过期，请重新登录后继续。',
  ],
  tooManyRequests: [
    'Too many requests. Wait a moment before trying again.',
    '操作过于频繁，请稍后再试。',
  ],
  requestRejected: [
    'The request was not accepted. Check the username and try again.',
    '申请未被接受，请核对用户名后重试。',
  ],
  searchResults: ['Search results', '搜索结果'],
  usernameChangeHint: [
    'Changing your username starts its change cooldown. Your friendships stay the same.',
    '修改用户名后需等待冷却结束才能再次修改，已有好友关系不受影响。',
  ],
  copySetupKey: ['Copy setup key', '复制设置密钥'],
  center: ['Your Nimi account', '你的 Nimi 账号'],
  overview: ['Overview', '账号首页'],
  profile: ['Personal profile', '个人资料'],
  friends: ['Friends', '好友'],
  privacy: ['Privacy', '隐私'],
  security: ['Sign-in & security', '登录与安全'],
  sessions: ['Login sessions', '登录会话'],
  data: ['Your data', '你的数据'],
  delete: ['Delete account', '注销账号'],
  welcome: ['A space for you and your connections.', '在 Nimi，保持自己的样子，也与朋友保持联系。'],
  profileIntro: ['Choose how people see you across Nimi.', '让朋友在 Nimi 中认出你。'],
  friendsIntro: [
    'Find someone you know. Keep your connections in your hands.',
    '找到认识的人，自在地管理彼此的联系。',
  ],
  privacyIntro: [
    'Choose who can see your information and contact you.',
    '决定谁可以看到你的信息、向你发起联系。',
  ],
  securityIntro: [
    'Manage how you sign in and protect your account.',
    '管理登录方式，保护你的账号。',
  ],
  sessionsIntro: ['Review where your account is signed in.', '查看和管理账号的登录记录。'],
  dataIntro: [
    'Take a copy of your information, or manage your account’s future.',
    '保存一份自己的信息，或决定账号的去留。',
  ],
  home: ['Nimi home page', 'Nimi 首页'],
  help: ['Account recovery', '账号恢复'],
  signOut: ['Sign out', '退出登录'],
  edit: ['Edit profile', '编辑资料'],
  viewFriends: ['View friends', '查看好友'],
  managePrivacy: ['Manage privacy', '管理隐私'],
  profileHint: ['Your name, avatar and introduction', '头像、名字与个人介绍'],
  friendsHint: ['Friends, requests and blocked accounts', '好友、申请与屏蔽名单'],
  securityHint: ['Password and sign-in methods', '密码与登录方式'],
  privacyHint: ['Who can find and contact you', '谁能看到你、联系你'],
  across: ['One identity across Nimi', '一个身份，连接 Nimi'],
  acrossHint: ['Changes here also appear in Nimi Home.', '这里的更改也会同步到 Nimi Home。'],
  loading: ['Loading your information…', '正在读取你的信息…'],
  retry: ['Try again', '重试'],
  save: ['Save changes', '保存更改'],
  saving: ['Saving…', '正在保存…'],
  saved: ['Changes saved.', '更改已保存。'],
  cancel: ['Cancel', '取消'],
  discard: ['Discard unsaved changes?', '放弃尚未保存的更改？'],
  unavailable: ['We couldn’t load this. Try again.', '暂时无法读取，请重试。'],
  changed: [
    'The signed-in account has changed. Reload this page before continuing.',
    '登录账号已变化，请重新载入页面后继续。',
  ],
  refreshedFailed: [
    'The change was saved, but the list could not refresh. Try refreshing it.',
    '操作已完成，但列表未能刷新，请重试读取。',
  ],
  name: ['Display name', '显示名称'],
  bio: ['About you', '个人介绍'],
  bioHint: ['A few words to introduce yourself.', '用几句话介绍自己。'],
  city: ['City', '城市'],
  country: ['Country / region code', '国家或地区代码'],
  countryHint: [
    'Two letters, for example CN or US. Optional.',
    '两位字母，例如 CN 或 US。可留空。',
  ],
  avatar: ['Change photo', '更换头像'],
  avatarHint: ['Choose a JPG, PNG or WebP image.', '选择 JPG、PNG 或 WebP 图片。'],
  avatarPending: [
    'Photo uploaded. Save changes to publish it.',
    '头像已上传，保存更改后才会生效。',
  ],
  uploading: ['Uploading…', '正在上传…'],
  invalidImage: ['Choose a JPG, PNG or WebP image.', '请选择 JPG、PNG 或 WebP 图片。'],
  username: ['Username', '用户名'],
  usernameHint: [
    'Friends can add you using your exact username.',
    '朋友可以通过完整用户名添加你。',
  ],
  copy: ['Copy username', '复制用户名'],
  copied: ['Username copied.', '用户名已复制。'],
  copyFailed: [
    'Couldn’t copy. Select your username and copy it manually.',
    '复制失败，请选中用户名手动复制。',
  ],
  changeUsername: ['Change username', '修改用户名'],
  usernameLater: ['You can change it again on', '下次可修改时间：'],
  usernameSaved: ['Username changed.', '用户名已修改。'],
  allFriends: ['All friends', '全部好友'],
  received: ['Received', '收到的申请'],
  sent: ['Sent', '发出的申请'],
  blocked: ['Blocked', '已屏蔽'],
  add: ['Add a friend', '添加好友'],
  addHint: [
    'Enter their exact username. No public search is needed.',
    '输入对方的完整用户名，即可发起好友申请。',
  ],
  handlePlaceholder: ['For example, @alex', '例如 @alex'],
  message: ['A short introduction (optional)', '打个招呼（选填）'],
  sendRequest: ['Send request', '发送申请'],
  requestSent: ['Friend request sent.', '好友申请已发送。'],
  alreadyFriends: ['You’re now friends.', '你们已经是好友了。'],
  unchanged: ['This relationship is already up to date.', '关系已是最新状态。'],
  requestUnknown: [
    'The result is uncertain. Check Sent requests before sending another request.',
    '目前无法确认结果，请先查看发出的申请，再决定是否重新发送。',
  ],
  checkSent: ['Check sent requests', '查看发出的申请'],
  search: ['Search your friends', '搜索我的好友'],
  searchButton: ['Search', '搜索'],
  refresh: ['Refresh', '刷新'],
  more: ['Load more', '加载更多'],
  emptyFriends: ['Your friends will appear here', '好友会出现在这里'],
  emptyFriendsBody: [
    'Add someone you know with their username. You can chat in Nimi Home once your connection is ready.',
    '用用户名添加认识的人，建立联系后就可以在 Nimi Home 中聊天。',
  ],
  emptyReceived: ['No new requests', '暂时没有新的申请'],
  emptyReceivedBody: [
    'When someone sends you a friend request, you can review it here.',
    '有人向你发起好友申请时，你可以在这里处理。',
  ],
  emptySent: ['No pending requests', '没有等待处理的申请'],
  emptySentBody: [
    'Requests you send will appear here until they’re handled.',
    '发出的申请会在这里等待对方处理。',
  ],
  emptyBlocked: ['Your blocked list is empty', '目前没有屏蔽任何人'],
  emptyBlockedBody: [
    'You can block someone when you don’t want further contact.',
    '当你不希望继续被联系时，可以选择屏蔽对方。',
  ],
  noMatches: ['No matching friends', '没有找到匹配的好友'],
  noMatchesBody: ['Try another name or clear your search.', '换个名字试试，或清空搜索。'],
  accept: ['Accept', '接受'],
  reject: ['Decline', '拒绝'],
  cancelRequest: ['Cancel request', '取消申请'],
  remove: ['Remove friend', '移除好友'],
  block: ['Block', '屏蔽'],
  unblock: ['Unblock', '解除屏蔽'],
  actions: ['More actions', '更多操作'],
  confirm: ['Confirm', '确认'],
  actionDone: ['Done. Your relationship has been updated.', '操作完成，关系已更新。'],
  stateChanged: [
    'This request or relationship has changed. Refresh to see its current state.',
    '这条申请或关系已变化，请刷新后查看当前状态。',
  ],
  confirmRemove: [
    'Remove this friend? Your existing chat history will remain.',
    '移除这位好友？已有聊天记录会保留。',
  ],
  confirmBlock: [
    'Block this person? New contact will be restricted. Existing history and friendship are kept.',
    '屏蔽此用户？新的联系会受到限制，已有聊天记录和好友关系会保留。',
  ],
  confirmUnblock: [
    'Unblock this person? Your current privacy settings will apply again.',
    '解除屏蔽？之后会重新按你的隐私设置允许联系。',
  ],
  deletedUser: ['Deleted account', '已注销账号'],
  chatHome: ['Conversations continue in Nimi Home.', '与朋友的聊天继续在 Nimi Home 中进行。'],
  everyone: ['Everyone', '所有人'],
  friendsOnly: ['Friends', '仅好友'],
  onlyMe: ['Only me', '仅自己'],
  nobody: ['No one', '不允许'],
  allowed: ['Allow', '允许'],
  closed: ['Closed', '关闭'],
  profileVisibility: ['Who can view your profile', '谁可以查看我的资料'],
  friendListVisibility: ['Who can see your friends', '谁可以查看我的好友名单'],
  dmVisibility: ['Who can message you', '谁可以给我发私信'],
  friendRequestVisibility: ['New friend requests', '新的好友申请'],
  onlineStatusVisibility: ['Who can see your online status', '谁可以查看我的在线状态'],
  requestPolicy: [
    'Closing new requests won’t remove existing requests or friends.',
    '关闭后不再接受新的申请，已有申请和好友不受影响。',
  ],
  privacyNote: [
    'These choices apply across Web and Nimi Home. Blocking someone is a separate action.',
    '这些设置在 Web 和 Nimi Home 中共同生效。屏蔽用户是独立操作。',
  ],
  password: ['Password', '密码'],
  passwordHint: [
    'Use a strong password you don’t use elsewhere.',
    '使用足够安全、且未在其他地方使用的密码。',
  ],
  passwordSignInAgain: ['Your sessions have ended. Sign in with your new password.', '原有登录会话已结束，请使用新密码重新登录。'],
  oldPassword: ['Current password', '当前密码'],
  newPassword: ['New password', '新密码'],
  repeatPassword: ['Confirm new password', '确认新密码'],
  passwordMismatch: ['The passwords don’t match.', '两次输入的密码不一致。'],
  twoFactor: ['Two-step verification', '两步验证'],
  twoFactorHint: [
    'Add a verification code from your authenticator app when signing in.',
    '登录时使用验证器提供的验证码，多一层保护。',
  ],
  enabled: ['Enabled', '已开启'],
  notEnabled: ['Not enabled', '未开启'],
  setupKey: ['Setup key', '设置密钥'],
  setupHint: [
    'Add this key to your authenticator app, then enter its six-digit code below.',
    '在验证器中添加此密钥，然后输入生成的 6 位验证码。',
  ],
  connected: ['Connected accounts', '关联账号'],
  connectedHint: ['Use these accounts to sign in to Nimi.', '使用这些账号登录 Nimi。'],
  linked: ['Connected', '已关联'],
  notLinked: ['Not connected', '未关联'],
  sessionShortcut: ['Review login sessions', '查看登录会话'],
  deleteHint: [
    'Permanently close your account. Review what happens before continuing.',
    '永久关闭账号。继续前请先了解数据处理后果。',
  ],
  notFound: ['This account page doesn’t exist', '这个账号页面不存在'],
  backAccount: ['Back to your account', '返回账号首页'],
  signedOut: ['Sign in to your Nimi account', '登录你的 Nimi 账号'],
  signedOutHint: [
    'Manage your profile, friends and account in one place.',
    '在同一个地方管理资料、好友和账号。',
  ],
} as const;
export type AccountCopyKey = keyof typeof accountCenterCopy;
export function useAccountCopy() {
  const { i18n } = useTranslation();
  const index = i18n.language.startsWith('zh') ? 1 : 0;
  return useCallback((key: AccountCopyKey) => accountCenterCopy[key][index], [index]);
}

export function accountReadProblem(reason: unknown, copy: (key: AccountCopyKey) => string): string {
  const failure = asNimiError(reason);
  if (failure.details?.status === 429) return copy('tooManyRequests');
  if (failure.reasonCode === 'AUTH_ACCOUNT_CONTEXT_CHANGED' || failure.message === copy('changed'))
    return copy('changed');
  return copy('unavailable');
}
