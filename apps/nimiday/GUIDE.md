# NimiDay

NimiDay 让你的 Nimi 助理替你照看日常：家人、自己、家里的大小事，按时间和对象整理好，到点提醒，重要的事情有人帮你安排和跟进。

## 你可以做什么

- **今天**：一眼看到现在要处理的事、今天的安排、等你决定的问题、其他 App 的新变化，以及每项技能最近一次的照看结果。直接写“周五 9:30 带小米打疫苗”“每周二五晚上 8 点倒垃圾”，NimiDay 会识别时间、重复，并把提到的人归到对应的照看对象下。
- **照看**：为孩子、长辈、伴侣、自己、家、宠物、健康或账单建立照看对象，写下要照看什么、关注点，并在家庭手册里记下长期有用的信息（过敏、习惯、联系人……）。
- **事项**：待办、约定、提醒和跟进，支持全天、准时或提前提醒、重复、打扰程度（轻提醒 / 普通 / 重要）、稍后提醒和“不做了”。选了“稍后”的事会先离开“现在”，到时间再提醒你。
- **来自其他 App 的提醒**：ParentOS 的成长记录、疫苗和体检等照看提醒，时镜的日镜解读，会归到对应的人下面，并标明是“提醒”还是“解读”。可以一键去原 App 处理，或“安排进日程”，变成你自己的事项。安排好之后两边分开显示：NimiDay 里是你的安排（比如“周六 09:00 带小米做体检”），原 App 里的记录仍要在原 App 完成；完成安排时，如果那边还开着，NimiDay 会提醒你去那边记录。今天页会把其他 App 里等你处理的提醒单独列出来。家里有几个孩子时，ParentOS 的记录会按孩子分组，在设置里把每一组对应到相应的人即可。
- **例行与技能**：晨间照看、晚间收尾、一周家庭安排、约定前准备、采购清单、生日与纪念日、整理新变化、照看回顾。技能的做法可以调整，也可以记下“这个家的经验”，以后谁来照看都会照做；例行决定什么时候做，可以到点提醒你开始，也可以到点自动开始。
- **助理**：任命一位你已有的 Nimi 助理（例如 Aya）。TA 保持自己的性格和记忆；NimiDay 只提供这份岗位的做法、你交代的资料和生活技能。在对话里直接说“后天下午三点提醒我给妈妈打电话”，TA 会真的在 NimiDay 里建好事项，回复下方列出改了什么并可一键撤销；如果 TA 只是口头答应而没有真正记下，NimiDay 会提醒你并提供“现在加上”。TA 留给你的问题（例如“体检定周六还是周日”），你选好之后可以直接让 TA 接着安排。也可以说话转成文字、像打电话一样和 TA 语音通话、请 TA 在桌面上出现、工作交流保存在 Day，显式语音通话进入同一 Agent 的规范聊天。
- **Nimi Home**：到期的提醒、需要你决定的事和助理的照看结果会出现在 Home 的消息里，处理后会自动关闭。

## 安排与回复跟进

- **添加参考资料**：可以直接读取授权的外部文档或 NimiGo 中生成的项目成果。导入后，NimiDay 会显示文档标题与正文；你可以确认正文或编辑需要保留的摘录，保存到对应的家庭手册中。
- **安排 Telegram 跟进**：你可以配置 Telegram 机器人，向指定联系人发送通知并跟进回复：
  - **准备联系人**：让对方先在 Telegram 中给你的 Bot 发送一条私聊消息，获取其数字聊天 ID（Chat ID）。在 NimiDay 中按“数字 ID 姓名”添加。
  - **进度清晰**：从建立安排、发出通知到收到并确认回复，每一步进度都会清晰展示。
  - **安全防扰**：每个联系人同一时间只进行一项跟进任务；发送未确认时不会重复轰炸对方，需要你手动确认或改为自行沟通。
- **引用 NimiGo 成果**：在 NimiGo 中打开文档，复制版本引用并粘贴到 NimiDay，即可预览并关联该成果内容。
- **遇到需要决定的事项**：如果对方回复的内容需要你定夺（如确认具体时间），事项会出现在“需要你决定”中。补充说明后可让助理继续跟进，也可以随时点击“结束跟进，改为手动处理”。
- **真实判断**：只有助理真正分析并确认了对方的答复，才算跟进完成；如果对方后续发来更正信息，助理也会及时更新判断。

## 运行方式

- **后台跟进**：只关闭窗口、没有退出 NimiDay 时，已在后台启动的跟进可以继续；可在系统菜单中选择“退出并停止 NimiDay”。
- **准时提醒与例行**：窗口打开（可最小化）时，提醒和例行事项会准时触发；窗口关闭期间不会自动推进例行任务，错过的提醒会在下次打开时的“你不在时”统一展示。
- **可靠保存**：助理明确确认“记下了”，内容才会真正保存；若网络或服务出现异常，助理会如实说明未保存并提供重试按钮。
- **改动可追溯、可撤销**：助理调整过的日程事项均有记录，支持一键撤销。撤销记录和你的新决定会自动同步给助理，避免重复旧动作。
- **数据与记忆隔离**：你的日程、家庭手册和照看对象始终保存在本地。更换助理时，已有数据完整保留；助理在 NimiDay 中的工作记录与主对话记忆保持独立，互不混淆。

## English

NimiDay lets your Nimi companion look after everyday life: the people and things you care about, organized by time and person, with on-time reminders and a companion who plans, prepares, and follows up using everyday skills.

- **Reminders & routines**: Care and growth reminders from apps like ParentOS and ShiJing are grouped under the right person and can be added directly to your schedule.
- **Telegram follow-up**: Your companion can reach out to trusted contacts via Telegram, collect their replies, and help you finalize plans.
- **Reliable tracking**: Changes made by your companion can be reviewed and undone with a single click. When follow-ups need your input, you can add notes or take over directly.
- **Privacy & local storage**: Your family handbook, care objects, and schedules stay securely on your computer. When you switch companions, your personal data remains intact.
