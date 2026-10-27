# NimiDay

NimiDay 帮你把家人、自己和家里的大小事整理在一处：记下安排、设置提醒，也可以请 Nimi 助理帮忙准备和跟进。

## 你可以做什么

- **今天**：集中查看当前要处理的事、今日日程、等你拍板的问题、其他 App 的新变化，以及日常工具最近一次的执行结果。直接输入“周五 9:30 带小米打疫苗”或“每周二五晚上 8 点倒垃圾”，核对识别出的时间、重复规则和照看对象后，再保存为事项。
- **照看与家庭手册**：为孩子、长辈、伴侣、自己、家、宠物、健康或账单建立照看对象，记录照看重点，并在“家庭手册”里保存过敏情况、生活习惯、常用联系人等长期资料。
- **事项管理**：管理待办、约定、提醒和跟进。支持全天、到点或提前提醒、重复规则、打扰程度（轻提醒 / 普通 / 重要）、“稍后”以及“不做了”。选择“稍后”的事项会暂时离开当前列表，到时间再提醒你。
- **汇总其他 App 的提醒**：ParentOS 的成长记录、疫苗和体检提醒，以及“时镜”的日镜解读，会归入对应的人名下并标明“提醒”或“解读”：
  - **今天页集中处理**：在“今天”页可一键跳回原 App 处理，或点击“安排进日程”转为 NimiDay 事项。多孩家庭可在设置中将 ParentOS 分组对应到具体成员。
  - **日程与原记录分开结项**：排入日程后，NimiDay 负责跟进你的时间安排；原 App 里的记录仍需在原 App 内完成。在 NimiDay 勾选完成时，若原记录尚未结项，系统会提醒你去补记。
- **日常安排与常用工具**：在“固定安排”中设置每天或每周例行事项，可选择到点提醒你，或在应用保持开启时由助理到点启动。“常用工具”提供晨间照看、晚间收尾、一周家庭安排、约定前准备、采购清单、生日与纪念日、整理新变化、照看回顾等模板。你可以调整做法、记下“这个家的经验”，或创建自定义工具；更换助理后，这些做法和经验仍会保留，执行进度与结果可在“最近记录”中查看。
- **助理协作**：任命一位已有的 Nimi 助理（如 Aya），结合你填写的家庭资料与日常工具开展工作：
  - **改动可查可撤**：在对话中请助理建事项或改日程时，实际写入 NimiDay 的改动会在回复下方列出明细。你可以撤销可恢复的改动；之后被你修改或处理过的内容会保留；如果助理仅在对话中口头答应而未实际写入，界面会提示并提供“现在加上”按钮。
  - **问题接力与多方式交流**：对助理留下的选择题拍板后，可让 TA 接着安排。支持语音转文字、语音通话或桌面浮窗陪伴。
- **Nimi Home 联动**：到期的提醒、待决定的事和助理的照看结果会同步显示在 Nimi Home 消息中，处理完毕后自动关闭。

## 开始使用

1. 在 Nimi Home 中打开 NimiDay，并保持 Nimi 运行。
2. 在“照看”中添加家人或关注领域，或直接在“今天”页记下第一件事，核对后保存。
3. 需要助理协作时，在“助理”页选择一位可供 NimiDay 使用的伙伴，并准备相应 AI 能力；不使用助理时，也可以手动安排事项。

## 外部资料与 Telegram 跟进

- **导入参考资料与引用 NimiGo 成果**：可读取已授权的外部文档或 NimiGo 项目成果，确认全文或编辑摘录后存入对应的家庭手册；也可在 NimiGo 中复制特定版本的引用并粘贴到 NimiDay，直接预览和关联该版本。
- **配置与发起 Telegram 跟进**：
  1. 配置 Telegram 机器人后，先请联系人在 Telegram 中向你的 Bot 发送一条私聊消息以获取数字聊天 ID（Chat ID），再按“数字 ID 姓名”格式将联系人添加到 NimiDay。
  2. **发送前核对**：发起 Telegram 通知前，需由你先核对接收人和消息正文，确认无误后再发送。
  3. **防打扰与人工接管**：每位联系人同一时间只进行一项跟进；发送状态未确认时不会重复发送，需由你手动确认或改为自行沟通。当收到对方回复后，助理会更新跟进状态；若回复内容需要你拿主意（如敲定碰面时间），事项会进入“需要你决定”，你可以补充指示让助理继续，或点击“结束跟进，改为手动处理”。

## 运行、数据与费用

- **提醒与固定安排的运行条件**：到期提醒和“固定安排”自动触发，需要 Nimi 与 NimiDay 窗口保持运行（含最小化）。窗口关闭期间不会自动推进固定安排，错过的提醒会在下次打开应用时汇总到“你不在时”。通知是否弹出还取决于系统权限与勿扰设置。
- **后台任务与停止限制**：仅关闭窗口而未退出应用时，已启动的后台跟进任务会继续运行；如需彻底停止，请在系统菜单中选择“退出并停止 NimiDay”。点击“结束跟进”或停止任务只能终止后续动作，**无法撤回已经发出的 Telegram 消息或已经生效的业务修改**；界面中的撤销操作会保留你后来修改或处理过的内容。
- **界面确认才算生效**：助理的角色设定、可用工具、对话中的口头答应或草稿，都不代表事项已成功保存或外部通知已送达。请始终以界面中实际保存的事项和状态记录为准。
- **本地保存与对话记录**：你的日程、照看对象、家庭手册及应用内工作交流均保存在本机设备，更换助理不会丢失数据。工作交流记录保存在 NimiDay；显式语音通话则使用同一位伙伴在 Nimi 中的对话。
- **云端推理与费用说明**：业务数据保存在本机，**不代表模型推理都在本机完成**。当你选择云端模型、语音服务或启用 Telegram 等外部集成时，完成任务所需的上下文和资料会发送给相应的服务提供方，并可能按所选服务或模型产生费用。
- **故障排查**：若遇到网络、Runtime 或服务连接异常，可按界面提示重试；如需在 Nimi Home 中排查运行环境问题，可前往 **设置 > 故障排查**（版本与软件信息位于 **帮助 > 关于**）。

## English

NimiDay helps your Nimi companion organize everyday life around the people and things you care about—managing schedules, care notes, routines, and follow-ups in one place.

### What You Can Do & First Steps

1. **Start with your day**: Open NimiDay from Nimi Home and keep Nimi running. You can add and manage items manually; select an available Nimi companion and configure AI when you want help from the assistant.
2. **Set up Care Profiles & Family Handbook**: Create profiles for family members, yourself, pets, or household bills, and record long-term notes (such as allergies or key contacts) in the Family Handbook.
3. **Manage Today & Cross-App Reminders**: Add to-dos and recurring routines on the **Today** page. Reminders and readings from apps like ParentOS and ShiJing are grouped under the relevant person so you can jump to the source app or schedule them into your day.
4. **Use Telegram Follow-Up & NimiGo References**: Link versioned deliverables from NimiGo into your handbook, or configure a Telegram bot for private chats using verified numeric chat IDs (`Chat ID Name`). Review recipients and notice text before sending.

### Important Conditions, Privacy & Costs

- **Verify saved changes & messages**: A companion’s role setup, available skills, or chat reply does not guarantee a task is completed. Always verify that schedule changes are recorded in the UI (undo keeps items you later edited or handled yourself). Before sending any Telegram notification, you must review and confirm both the recipient and the message text.
- **Running conditions for reminders**: Due reminders and scheduled routines require both Nimi and the NimiDay window to remain open (or minimized). While the window is closed, routines do not advance automatically, and missed reminders are collected under **While you were away** (`你不在时`) next time you open the app. Notification display also depends on system permissions and Do Not Disturb settings.
- **Stopping tasks & irreversible actions**: Closing the window leaves active background follow-ups running unless you choose **Quit and Stop NimiDay** from the menu. Ending a follow-up or stopping a task only halts subsequent steps—it **cannot recall Telegram messages already sent or revert business changes already completed**.
- **Local storage, cloud inference & fees**: Your schedules, care profiles, family handbook, and work logs are stored on your device. Work conversations are recorded in NimiDay; explicit voice calls use the companion’s Nimi conversation. However, **local data storage does not mean model inference runs locally**. When you use cloud models, voice services, or external integrations like Telegram, the data required for the task is sent to those services and may incur charges.
- **Troubleshooting**: If a service or connection issue occurs, retry as prompted in the app, or check **Settings > Troubleshooting** (`设置 > 故障排查`) and **Help > About** (`帮助 > 关于`) in Nimi Home.
