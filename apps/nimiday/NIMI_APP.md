# NimiDay

NimiDay 让你的 Nimi 助理替你照看日常：家人、自己、家里的大小事，按时间和对象整理得井井有条；到点准时提醒，重要的事有人帮你安排和跟进。

## 你可以做什么

- **今天**：一眼看到现在要处理的事、今天的安排、等你拿主意的问题、其他 App 的新变化，以及每个工具最近一次的照看结果。直接输入“周五 9:30 带小米打疫苗”或“每周二五晚上 8 点倒垃圾”，NimiDay 会自动识别时间与重复规则，并把提到的人归入对应的照看对象。
- **照看**：为孩子、长辈、伴侣、自己、家、宠物、健康或账单建立照看对象，写下照看重点，并在“家庭手册”里记下长期有用的信息（如过敏情况、生活习惯、常用联系人等）。
- **事项**：管理待办、约定、提醒和跟进。支持全天、准时或提前提醒、重复规则、打扰程度（轻提醒 / 普通 / 重要）、稍后提醒以及“不做了”。选择“稍后”的事项会暂时离开“现在”，到时间再提醒你。
- **来自其他 App 的提醒**：ParentOS 的成长记录、疫苗和体检提醒，以及“时镜”的日镜解读，都会归到对应的人名下，并标明是“提醒”还是“解读”：
  - **今天页集中展示**：其他 App 里等你处理的提醒会在“今天”页单独列出，方便一键跳转原 App 处理，或点击“安排进日程”变成你自己的事项。
  - **日程与原记录分开跟进**：排进日程后，NimiDay 显示你的时间安排（如“周六 09:00 带小米做体检”），而原 App 里的记录仍需在原 App 内完成；当你在 NimiDay 勾选完成时，如果原 App 那边的记录还没结项，NimiDay 会贴心提醒你去补记。
  - **多孩家庭分组**：家里有几个孩子时，ParentOS 的记录会按孩子分组，在设置里把每一组对应到相应的人即可。
- **日常**：在“固定安排”里设置每天或每周要做的事，选择到点提醒你开始，或请助理到点自动开始。“常用工具”提供晨间照看、晚间收尾、一周家庭安排、约定前准备、采购清单、生日与纪念日、整理新变化、照看回顾等帮助。你可以调整做法、记下“这个家的经验”，也可以创建自己的工具；换了助理，这些做法和经验仍会保留。进度和结果可以在“最近记录”里查看。
- **助理**：任命一位你已有的 Nimi 助理（例如 Aya）。TA 会保持原本的性格与记忆，由 NimiDay 为 TA 配备这份岗位的做法、你交代的家庭资料和日常工具：
  - **说到做到，可查可撤**：在对话里直接说“后天下午三点提醒我给妈妈打电话”，TA 会真正在 NimiDay 里建好事项，并在回复下方列出改动明细、支持一键撤销；万一 TA 只是口头答应而没能真正记下，NimiDay 会主动提醒你并提供“现在加上”按钮。
  - **问题接力**：TA 留给你的选择题（例如“体检定周六还是周日”），你拍板后即可直接让 TA 接着安排。
  - **多种交流方式**：支持语音转文字输入、像打电话一样与 TA 语音通话，或让 TA 以桌面浮窗陪伴。应用内的日常工作交流保存在 NimiDay 中；发起显式语音通话时，通话内容则会进入同一位助理在 Nimi 的规范聊天。
- **Nimi Home 联动**：到期的提醒、等你决定的事以及助理的照看结果都会同步出现在 Nimi Home 的消息里，处理完毕后自动关闭。

## 安排与回复跟进

- **添加参考资料与引用 NimiGo 成果**：可以直接读取已授权的外部文档或 NimiGo 生成的项目成果。导入后，NimiDay 会显示文档标题与正文，供你确认全文或编辑摘录并存入对应的家庭手册；你也可以在 NimiGo 中打开文档，复制版本引用并粘贴到 NimiDay，直接预览和关联该成果。
- **安排 Telegram 跟进**：配置 Telegram 机器人后，助理可以向指定联系人发消息并跟进回复：
  - **准备联系人**：先让对方在 Telegram 中给你的 Bot 发一条私聊消息以获取数字聊天 ID（Chat ID），再在 NimiDay 中按“数字 ID 姓名”格式添加。
  - **进度清晰**：从建立安排、发出通知到收到并确认回复，每一步状态一目了然。
  - **安全防扰**：每位联系人同一时间只进行一项跟进任务；消息发送未确认时绝不重复轰炸对方，需由你手动确认或改为自行沟通。
- **遇到需要决定的事项**：如果对方的回复需要你拿主意（例如确认具体碰面时间），该事项会出现在“需要你决定”中。你可以补充说明让助理继续跟进，也可以随时点击“结束跟进，改为手动处理”。
- **真实判断**：只有当助理真正分析并确认了对方的答复，跟进才会标记为完成；如果对方事后发来更正消息，助理也会及时更新判断。

## 运行方式

- **后台跟进**：仅关闭窗口而未退出 NimiDay 时，已在后台启动的跟进任务会继续运行；如需彻底停止，可在系统菜单中选择“退出并停止 NimiDay”。
- **准时提醒与固定安排**：窗口打开（含最小化）期间，提醒和固定安排会准时触发；窗口关闭期间不会自动推进固定安排，错过的提醒会在下次打开时统一汇总在“你不在时”。
- **可靠保存**：在界面中确认事项与保存结果，才算真正记好了；助理口头答应不等于已经保存。若遇到网络或服务异常，按界面提示重试。
- **改动可追溯、可撤销**：助理调整过的每一项日程均有记录并支持一键撤销。你的撤销操作和新决定会自动同步给助理，避免重复旧动作。
- **数据与记忆隔离**：你的日程、家庭手册和照看对象始终保存在本地设备。更换助理时，已有数据完整保留；助理在 NimiDay 中的工作记录与其主对话记忆相互独立，互不混淆。

## English

NimiDay lets your Nimi companion look after everyday life: the people and things you care about, organized by time and person, with on-time reminders and a companion who plans, prepares, and follows up using everyday skills.

- **Reminders & routines**: Care and growth reminders from apps like ParentOS and ShiJing are grouped under the right person and can be scheduled directly into your day.
- **Telegram follow-up**: Your companion can reach out to trusted contacts via Telegram, collect their replies, and help you finalize plans.
- **Reliable tracking**: Review your companion’s recorded schedule changes and use the available undo action. When a follow-up needs your input, you can add notes or take over at any time.
- **Privacy & local storage**: Your family handbook, care objects, and schedules stay locally on your computer. Switching companions keeps all your personal data intact.
