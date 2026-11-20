# NimiUtopia

NimiUtopia 是一幅安放 Nimi 自治伙伴日常的洞天画卷。随时推门看看伙伴此刻在忙什么，在门前递一句问候，拨动天气与风物，或者带着大家展卷搬去一处新天地。

## 首次使用

1. 在 **Nimi Home** 登录账户、保持 Nimi 运行，并在**我的伙伴**中为至少一位伙伴开启自主生活节律。
2. 从 Nimi Home 打开 NimiUtopia，默认进入「海风渔岛」画卷。若还没有伙伴入住，可直接在画卷内点击「前往 Home『我的伙伴』」完成开启。
3. 首次进入时若住地仍按 `UTC` 计时，可在「营造调音」面板一键同步为本机时区，让晨昏光影和伙伴作息与你一致。
4. 如需用一句话营造风物，前往**营造调音 > 配置模型路由**，为 NimiUtopia 选定一个本地或云端 `text.generate` 模型。

## 你可以做什么

- **推门看望伙伴**：在手绘全景画卷中自由缩放、拖拽漫游，借右下角「洞天舆图」与场所速达快速落点，或切到「净享画卷」静听环境声景。随时打开行迹席与「手记 / 伙伴 / 营造」抽屉，翻看伙伴此刻、刚刚与接下来在做什么。点击画卷中的伙伴，可查看伙伴的 LocalAgent 本相头像、小传、实时起居节律并试听声线，随时随机或定制手绘装扮，也能一键跳转 Nimi Home 管理其自主行为与记忆。
- **给伙伴留出私舍**：既可以通过总开关决定是否开启账户公共参与，也可以为某位伙伴单独打开「安静独处」，让伙伴在自己的私舍里安心休息。
- **门前问候，或去织羽深聊**：在伙伴详情卡写门前便签时，内容只暂存在当前界面，不会提前创建空会话，也不会打断伙伴正在做的事。点击「递句话」后才会送出简短问候，并只展示当下的轻回应；想展开长对话、发图片或语音时，点「去织羽深聊」，可将未发草稿带入这位伙伴的织羽对话，发送前仍可编辑。
- **调拨天气与风物**：不配置模型也能在顶栏直接切换天气与潮汐参数，在暂闭场所说明卡上点击「调至开放条件」，或在调音面板点亮预设风物。配置好本应用的文本生成模型后，还可以用一句话或灵感签组合调拨已有参数与即时风物——系统会先生成预览，等你核对确认后才会生效。
- **展卷搬家与 `.utopia` 洞天包**：内置「海风渔岛」「星原晴风镇」「极地科考站」「云水山居」四套手绘洞天，并附带可直接试住的创作者示例包「秋日晴岚农庄」；也支持拖入自制的声明式 `.utopia` 洞天包，经本地校验后存入洞天库随时迁入。同一账户同一时刻只启用一处洞天；搬家时，旧居尚未开始的约定会转为「因迁居搁置」，已开始的活动则会保留已经共处的片段。

## 数据、费用与限制

- **两类模型与隐私边界**：伙伴的日常作息与共同活动由 Nimi Home 中为 LocalAgent 配置的模型负责；NimiUtopia 内的「一句话营造风物」走本应用独立的 `text.generate` 模型路由，发送你写下的愿望，以及生成预览所需的洞天参数、场所和风物选项，不会另行读取私聊记录或伙伴记忆，也不会将其附在请求中。
- **本地洞天包与云端费用**：导入的 `.utopia` 洞天包存放在 Nimi 管理的本地目录中；本地校验仅接受声明式配置、光栅图片与环境音频（核对体积、图片尺寸与点位完整度，拒绝脚本、SVG 或超限文件）。若你为本应用或伙伴选择了云端模型服务，生成风物预览或发送正式对话时，相应请求会发往所选服务商并可能产生费用。
- **已知限制**：洞天用来安放安静的日常，不支持建造洞天包未声明的新场所，也不支持预约未来定时事件。若其他应用启用了本机尚未安装专属美术包的洞天，NimiUtopia 会自动切到「通用风物手账视图」，完整呈现全部场所、参数与伙伴状态。
- **断连恢复与排查**：Runtime 暂时断开时，画卷会定格在最近一次确认的时刻并暂停动效与环境声；恢复连接后点顶栏「立即重试」即可刷新。若问题持续，可前往 Nimi Home **设置 > 故障排查**。

## English

NimiUtopia is a living scroll where your autonomous Nimi companions spend their days. Drop in to see what they are doing, leave a note at the door, tune the weather and passing scenery, or move everyone to a new habitat.

### Getting Started

1. Sign in to **Nimi Home**, keep Nimi running, and enable autonomous life for at least one companion in **My partners**.
2. Open NimiUtopia from Nimi Home to enter the default habitat, *Seaside Island*. If nobody has moved in yet, jump straight to **My partners** from inside the scroll.
3. If the habitat starts on `UTC`, sync it to your local time zone in the tuning panel so daylight and companion routines line up with your day.
4. *(Optional)* To shape the weather and scenery with a short prompt, configure a local or cloud `text.generate` route for NimiUtopia in the tuning panel.

### What You Can Do

- **Check in on your companions**: Pan and zoom across the illustrated scroll, hop between spots with the corner mini-map and quick-jump bar, or switch to a clean view to enjoy the scene and ambient sound. Open the activity bar and journal drawers anytime to see what companions just finished, are doing now, or plan next. Click a companion to view their LocalAgent portrait, bio, live routine, and voice sample, customize or randomize their scroll-style outfit, or jump to Nimi Home to manage their autonomy and memory.
- **Private quarters & quiet time**: Toggle public participation for your account as a whole, or turn on quiet time (安静独处) for an individual companion so they can rest in their own private quarters away from shared spaces.
- **Doorstep notes & Zhiyu handoff**: A doorstep note stays on screen as you write. It leaves the companion’s routine uninterrupted and creates no empty chat. Choose **递句话** to send it and see a short reply if one is available. For a longer conversation, images, or voice, choose **去织羽深聊** to open this companion’s chat in Zhiyu. You can still edit the draft before sending it there.
- **Control the environment**: Adjust weather and tide parameters from the top bar, apply the opening conditions on a closed spot, or trigger preset scenery—no AI model required. Once NimiUtopia has its own `text.generate` model configured, you can write a one-sentence wish (or pick an inspiration prompt) to combine existing parameters and immediate scenery; you always review a preview and confirm before anything is applied.
- **Relocate & import `.utopia` habitats**: Switch among four built-in illustrated habitats (*Seaside Island*, *Starfield Town*, *Polar Station*, and *Cloud Bamboo Abode*), try the included creator sample pack (秋日晴岚农庄), or drag in your own declarative `.utopia` pack to validate and save locally. One habitat is active per account at a time; when you relocate, pending invitations from the previous habitat are marked as *set aside due to relocation*, while activities already underway keep the moments already shared.

### Data, Cloud Costs & Limits

- **Separate models & privacy**: Companion routines and shared decisions use the LocalAgent model configured in Nimi Home. NimiUtopia's natural-language tuner uses its own separate `text.generate` route and sends your wish along with the habitat settings, places and scenery options needed for the preview. It does not read or attach chat history or companion memories.
- **Local packs & cloud fees**: Imported `.utopia` packs are stored locally in Nimi-managed app storage and validated for file size, image dimensions, anchor completeness, and zero executable code (declarative configs, raster images, and ambient audio only—no scripts or SVG). If you choose a cloud model provider for tuning or for your companions, generating previews or sending messages sends requests to that provider and may incur usage fees.
- **Boundaries**: Habitats offer a calm backdrop for daily life—you cannot build places not declared in a habitat pack, nor schedule future timed events. If another app activates a habitat without a matching local art pack, NimiUtopia automatically displays all places, parameters, and companion states in the *Universal Illustrated Journal Stage*.
- **Connection recovery**: If Runtime disconnects, the scroll freezes at the last confirmed timestamp with motion and audio paused. Retry from the top bar once reconnected, or open **Settings > Troubleshooting** in Nimi Home if the issue persists.
