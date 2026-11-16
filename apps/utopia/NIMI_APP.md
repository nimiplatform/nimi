# NimiUtopia

NimiUtopia 是 Nimi 自治伙伴日常栖居的洞天画卷视窗：随时推门看望伙伴此刻、刚刚与接下来在做什么，调拨天气与风物景象，或展卷迁入不同题材的洞天。

## 你可以做什么

- **推门看望鲜活全景洞天与伙伴行迹**：默认以大幅 2.5D 手绘多街区画卷展开（支持「全景俯瞰 / 街区漫游 / 近景放大」多尺度镜头、鼠标拖拽漫游、右下角交互式「洞天舆图」缩略导航与场所速达条、「净享画卷」纯享视角及环境声景音量微调）；画卷点缀有昼夜灯塔光束、水车微澜、飞鸟掠影与可点击品读的「风物观景地标」（明确区分正式生活场所与漫步途经观景处）；每位伙伴以统一画风的纯手绘小人形象在庭院驻留、对坐同游或沿步道缓步漫行（支持一键随机或定制 12 款头饰、发型、神态与 10 款斗篷色）；左下角悬浮「伙伴行迹席」与右上「手记 / 伙伴 / 营造」羊皮卷抽屉让你随时翻看「今日洞天风物志」而无需离开画卷。
- **展卷迁居与 `.utopia` 洞天包**：内置「海风渔岛」「星原晴风镇」「极地科考站」「云水山居」四套手绘全景洞天长卷（拓展洞天最高包含 9 处正式生活场所与多处风物地标），并提供可一键检验与试住的创作者示例包「秋日晴岚农庄」；也支持拖入自制纯声明式 `.utopia` 洞天包，经本地安全校验后存入洞天库并迁居。同一账户同一时刻生效唯一洞天，迁居时原居所待开始的约定会体面转为「因迁居搁置」，已开始的活动保留已共处片段。
- **环境快拨与风物营造**：无需配置模型即可在顶栏一键快拨天气与潮汐参数、在暂闭场所说明卡点击「调至开放条件」，或在调音面板点亮预设风物签；配置本应用生成模型后，还可用一句话（或点选灵感签）组合调拨已有参数与即时风物，核对预览确认后才写入。
- **安静独处与公共参与**：可开启或关闭账户公共参与总开关，也可为任意一位伙伴单独开启「安静独处」，让其留在各自独立私舍内休息。
- **伙伴详情本相、手绘换装与门前便签 / 织羽深聊**：点选地图上的手绘小人即可展开其详情卡，查看伙伴真实的 LocalAgent 本相头像、世界出身小传、实时起居节律、试听声线样本，随时随机／定制其洞天手绘小人装扮，或一键跳转至 Nimi Home「我的伙伴」管理该伙伴的自主行为与记忆设置；门前便签在点击「递句话」前仅保存在当前界面，不会提前创建空会话或打断伙伴正在进行的活动；递出简短问候后仅展示近况轻回应，如需展开长对话、发送图片或语音，可一键点击「去织羽深聊」将当前伙伴与未发草稿无缝交接至织羽继续交流。

## 首次使用步骤

1. 在 Nimi Home 登录账户、保持 Nimi 运行，并在「我的伙伴」中至少为一位伙伴开启自主生活节律。
2. 从 Nimi Home 打开 NimiUtopia，即可查看默认生效的「海风渔岛」画卷与伙伴近况；若当前尚无入住伙伴，可在画卷内点击「前往 Home『我的伙伴』」直达设置页。
3. 若首次进入时住地仍按 UTC 计时，可在「营造调音」面板一键同步为本机时区，使晨昏光影与伙伴作息时段一致。
4. 如需使用「一句话营造风物」，点击「营造调音 > 配置模型路由」，为 NimiUtopia 选择可用的本地或云端文本生成模型。

## 所需配置、数据处理与边界说明

- **两类模型职责分离**：伙伴日常作息推进与共同活动决策，使用你在 Nimi Home 为 LocalAgent 配置的模型；NimiUtopia 内的「一句话营造风物」使用本应用独立的模型路由配置，仅接收当前洞天的公共参数与场所定义，**不会读取或上传任何私聊内容与伙伴记忆**。
- **本地资产与云端推理说明**：你导入的 `.utopia` 洞天包存储在应用受管本地资产目录中，仅支持声明式配置、光栅图像与环境音频（拒绝包含脚本、SVG 或超限文件）。若你为本应用或伙伴选择了云端模型服务，生成预览或发送正式对话时会将相应请求发送至所选模型服务商，并可能产生对应费用。
- **已知边界**：洞天提供安静的驻留生活背景，不支持自由建造未在洞天包中声明的新场所，也不支持预约未来定时事件；若第三方应用激活了尚未在本机安装专属美术包的洞天设定，NimiUtopia 会自动以「通用风物手账视图」完整呈现全部场所、参数与伙伴状态。
- **连接异常与帮助**：当 Runtime 暂时断开时，洞天画卷会定格在最近一次确认时刻并暂停声景与动效，恢复后点击顶栏「立即重试」即可刷新；如需排查运行环境，可前往 Nimi Home **设置 > 故障排查** 查看详情。

## English

NimiUtopia is the living habitat scroll for your autonomous Nimi companions—check in on what they are doing right now, tune weather parameters and passing scenery, or relocate your companions across themed habitats.

### What You Can Do & First Steps

1. **Open from Nimi Home**: Sign in to Nimi Home, keep Nimi running, and enable autonomous life for at least one companion in **My partners** (or jump there directly from NimiUtopia when no residents have moved in yet).
2. **Observe & Switch Habitats**: Pan and zoom across four built-in panoramic showcase habitats (*Seaside Island*, *Starfield Town*, *Polar Station*, and *Cloud Bamboo Abode*, with multi-scale overview/street zoom, an interactive corner mini-map, and scenic landmarks) or import declarative `.utopia` habitat bundles (validated locally for size, image dimensions, anchor completeness, and zero executable code). One habitat is active per account at a time; relocating cleanly marks pending prior-habitat invitations as *set aside due to relocation* while preserving already-shared moments.
3. **Tune Parameters & Scenery**: Adjust habitat parameters and preset scenery events directly with zero model setup. Optionally configure NimiUtopia's own `text.generate` model route to compile short natural-language wishes into a previewed tuning change before confirming.
4. **Doorstep Postcards & Zhiyu Handoff**: Drafting a doorstep note stays local until you explicitly send a quick check-in (*Send a note*)—which shows only immediate recent replies—or click *Chat deeply in Zhiyu* to hand off the companion and any unsent draft to Zhiyu for full multimodal conversation.

### Data Handling, Limits & Troubleshooting

- **Privacy & Cloud Costs**: Imported `.utopia` packs are stored locally in Nimi-managed app storage. The natural-language tuner sends only public habitat parameter/place metadata—never private chat logs or companion memories. Choosing a cloud model provider sends the relevant prompt or conversation turn to that provider and may incur usage fees.
- **Boundaries & Recovery**: Natural-language tuning adjusts declared parameters and immediate bounded scenery rather than constructing undeclared places. If an active habitat has no matching local art bundle, NimiUtopia automatically renders the Universal Illustrated Journal Stage. If Runtime disconnects, the stage freezes at the last confirmed timestamp until reconnected; see **Settings > Troubleshooting** in Nimi Home if connection issues persist.
