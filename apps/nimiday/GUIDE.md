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

“参考资料”可直接读取获准的外部文档或 Go 的指定成果版本，无需 Agent 或消息账户。Go 成果会显示文档标题与正文；确认正文或编辑需要保留的摘录后，可保存到现有家庭手册。结构化原始响应仅供高级查看，不会直接当作资料正文保存。

“安排跟进”可选择获准的 Telegram Bot 连接、私人聊天对象和实际发送正文。Day 会保存自己的安排、检查必要信息、通知固定对象，并判断真实收到的回复。必要时可参考获准的 Go 指定成果版本。

首期支持明确的私人聊天数字 ID；同一账户与对象同时只有一项等待中的安排。旧消息、其他对象消息以及通知之前的消息不会触发这项跟进。外部文本不能增加对象、换账户或要求 Day 额外发送消息。

让对方先在 Telegram 中私聊所选 Bot，再请 Bot 的管理者从这条消息的 Chat 信息核对数字 `id`、`private` 类型和对象姓名。每行填“数字 ID 对象名称”，不要填群组、频道或 `@用户名`；Bot 凭据仍只在 Nimi 管理。Telegram 的[Bot 使用说明](https://core.telegram.org/bots#how-do-bots-work)和[Chat 字段](https://core.telegram.org/bots/api#chat)解释了这两个前提。若连接已经由 Nimi 接收消息，不要另开一个接收程序争用同一 Bot。

使用 Go 成果时，在 Go 打开文档、选定版本后复制引用，粘贴到 Day 的“Go 成果版本引用”。Day 会识别版本并显示标题预览，调用时只使用其中三个精确标识；实际读取到的标题、正文和版本核对结果为准。原有三个标识的引用仍可读取。

安排建立、通知已发、回复已收及指定对象均确认分别显示。助理忙时保留原材料与账户，空闲后继续。通知效果未确认时停止后续动作，需手动核对，不自动重发。

“需要你决定”的原安排可填写补充说明。还没通知时，可补齐时间与通知正文，再明确发起新一次检查和发送；已经通知时，只处理尚未判断的实际回复，或继续等新回复，不改写和重发旧通知。每次继续都保留已发通知、收到的回复和补充说明。若不再继续，点“结束跟进，改为手动处理”，然后自行在 Telegram 沟通。发送效果未确认时只有核对和结束出口，不会用再次发送来猜测结果。

只有实际保存的回复判断才算处理完成；模型仅说“收到了”不算。已经收到的回复还没评估完时不会宣布全部确认，较晚的更正也会纳入判断。

## 运行方式

- “安排跟进”在关窗后继续，由仍在运行的 Day 执行部分负责；可停止某项跟进，或在菜单选择“退出并停止 Day”。退出、执行失效后不自动恢复或重发。
- NimiDay 窗口打开时（可以最小化）提醒和例行会准时进行；关闭期间到期的提醒，下次打开时显示在“你不在时”，例行不会自动补跑（只在打开的那一刻前后两分钟内到点的例行照常开始）。
- 助理说“记下了”，就是真的保存了：万一保存没有成功，助理会如实告诉你还没保存，NimiDay 也会提示并可以马上重试。
- 其他 App 的动态太多、一次没载入完时，列表下方会说明，并可以“载入更早的”。
- 安静时段内只有“重要”的提醒会打扰你，其余在结束后汇总告诉你。
- 助理对事项做的改动都会记录下来，可以一键撤销；随时可以停止 NimiDay 交给助理的事，不会打断 TA 在其他 App 里正在做的工作。撤销过的改动和你已经做的决定，NimiDay 会在下次交代工作时一并告诉助理，TA 不会按旧的说法继续。
- 和助理的连接断开时，NimiDay 会自动重新连接几次；仍连不上时如实告诉你，并可以手动重试。
- 更换助理时，NimiDay 交给原来那位、还没做完的事会先停止并如实记录；排队中的事交给新任的助理。
- 你的资料由 Nimi 按账号保存在本机。助理的性格、规范聊天和个人记忆由 Nimi 保管；Day 的业务交流与成果独立保存，不自动写入规范聊天或对话记忆；更换助理时，照看对象、事项、手册和技能都留在 NimiDay。

## English

NimiDay lets your Nimi companion look after everyday life: the people and things you care about, organized by time and person, with on-time reminders and a companion who plans, prepares and follows up using everyday skills. Reminders from other apps (ParentOS care and growth reminders, ShiJing daily readings) are filed under the right person and can be put on your own schedule. You can chat, dictate, or talk with your companion like a phone call. NimiDay runs while it is open (even minimized); reminders due while it is closed appear under "While you were away" and routines are never replayed.

Arrangements and replies can continue in the running Day Host after its window closes. Ask each recipient to message the chosen Telegram Bot privately, then have the Bot owner check the private chat ID and person’s name. Paste a copied Go version reference to reuse an exact document. When your decision is needed, add information to the original arrangement or end it and handle the conversation yourself. A new explicit attempt can check and send a previously unsent notice; it never resends an existing notice. Unknown send results require manual checking. Received replies are only considered processed after their assessments are saved, and all already-received replies are assessed before declaring completion.
