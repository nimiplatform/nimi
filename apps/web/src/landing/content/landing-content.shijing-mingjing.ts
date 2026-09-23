import type { HeroDemoShijingMingjing } from './landing-content.js';

/**
 * ShiJing (时镜) 命镜 preview content. The chart data below was produced by the
 * app's own deterministic engines (nimiapp-shijing: buildMingJingRouteProjection
 * for the 八字子平法, 紫微斗数(三合派), and 七政四余/果老星宗 method profiles, plus
 * the mingjing / qizheng narrative layers) for one demo user born 1990-04-12
 * 08:30 in Shanghai (male, reference year 2026), with three recorded life
 * events. Labels mirror the app's zh product copy. Only the AI reading outputs
 * (`reading.output` / `reading`) are hand-written mock text — no Runtime AI runs
 * in the landing demo.
 */
export const shijingMingjingPreviewContent: HeroDemoShijingMingjing = {
  "title": "命镜",
  "tendencyLabels": {
    "supportive": "助力",
    "steady": "平稳",
    "watch": "观察",
    "blocked": "阻滞",
    "turning": "转折"
  },
  "reading": {
    "generate": "生成命镜解读",
    "regenerate": "重新生成解读",
    "generating": "正在生成命镜解读…",
    "empty": "基于本命盘与你记录的历史事件，生成核心特点与长期阶段策略。",
    "stale": "生辰或历史事件已更新,可重新生成解读。"
  },
  "bazi": {
    "hero": {
      "eyebrow": "本命 · 命局总览",
      "title": "守火养光",
      "dayMaster": "丁火日主",
      "patternTag": "伤官格",
      "strengthTag": "身弱借力",
      "strengthClass": "weak",
      "persona": "你像一盏灯烛——温暖、专注，能在细处给人方向；又带着伤官的才气，表达力强、不愿将就。命局偏弱，最需要「木、火」的暖意和支撑：当你有方向、有依靠时，最能成事。",
      "favorableTitle": "时机有利 · 多依靠",
      "adverseTitle": "时机不利 · 宜节制",
      "favorable": [
        "wood",
        "fire"
      ],
      "adverse": [
        "earth",
        "metal",
        "water"
      ],
      "favorableHint": "暖意 · 方向 · 稳定靠山",
      "currentStageLabel": "当前所处阶段",
      "dayunWord": "大运",
      "notStarted": "尚未起运",
      "seeStages": "看我各阶段的起落 →",
      "current": {
        "pillar": "癸未",
        "stemElement": "water",
        "ageRange": "29–38岁",
        "nature": "watch"
      }
    },
    "paipan": {
      "sectionTitle": "你的命盘",
      "sectionIntro": "四柱记录出生年、月、日、时的干支结构。日柱天干是日主标识，其余柱位用于呈现不同时间位置的关系、五行与藏干信息。",
      "structureBadge": "伤官格 · 偏弱",
      "dayBadge": "这就是你",
      "dayMaster": "日主",
      "pillarLabels": {
        "year": "年柱",
        "month": "月柱",
        "day": "日柱",
        "hour": "时柱"
      },
      "roles": {
        "year": "长辈 / 根基",
        "month": "事业 / 社会",
        "day": "自己",
        "hour": "子女 / 晚年"
      },
      "rows": {
        "hidden": "藏干",
        "tenGod": "十神",
        "nayin": "纳音",
        "terrain": "长生",
        "voidRow": "空亡"
      },
      "voidMark": "空",
      "voidEmpty": "无",
      "expand": "展开完整排盘（藏干 · 纳音 · 长生 · 空亡）",
      "collapse": "收起完整排盘",
      "detailTitle": "完整排盘（藏干、纳音、十二长生、空亡）",
      "columns": [
        {
          "position": "year",
          "stemHanzi": "庚",
          "stemElement": "metal",
          "branchHanzi": "午",
          "branchElement": "fire",
          "hidden": [
            {
              "hanzi": "丁",
              "element": "fire",
              "weight": "primary"
            },
            {
              "hanzi": "己",
              "element": "earth",
              "weight": "middle"
            }
          ],
          "tenGod": "正财",
          "nayin": "路旁土",
          "terrain": "临官",
          "isVoid": false,
          "isDay": false
        },
        {
          "position": "month",
          "stemHanzi": "庚",
          "stemElement": "metal",
          "branchHanzi": "辰",
          "branchElement": "earth",
          "hidden": [
            {
              "hanzi": "戊",
              "element": "earth",
              "weight": "primary"
            },
            {
              "hanzi": "乙",
              "element": "wood",
              "weight": "middle"
            },
            {
              "hanzi": "癸",
              "element": "water",
              "weight": "residual"
            }
          ],
          "tenGod": "正财",
          "nayin": "白蜡金",
          "terrain": "衰",
          "isVoid": false,
          "isDay": false
        },
        {
          "position": "day",
          "stemHanzi": "丁",
          "stemElement": "fire",
          "branchHanzi": "未",
          "branchElement": "earth",
          "hidden": [
            {
              "hanzi": "己",
              "element": "earth",
              "weight": "primary"
            },
            {
              "hanzi": "丁",
              "element": "fire",
              "weight": "middle"
            },
            {
              "hanzi": "乙",
              "element": "wood",
              "weight": "residual"
            }
          ],
          "tenGod": "比肩",
          "nayin": "天河水",
          "terrain": "冠带",
          "isVoid": false,
          "isDay": true
        },
        {
          "position": "hour",
          "stemHanzi": "甲",
          "stemElement": "wood",
          "branchHanzi": "辰",
          "branchElement": "earth",
          "hidden": [
            {
              "hanzi": "戊",
              "element": "earth",
              "weight": "primary"
            },
            {
              "hanzi": "乙",
              "element": "wood",
              "weight": "middle"
            },
            {
              "hanzi": "癸",
              "element": "water",
              "weight": "residual"
            }
          ],
          "tenGod": "正印",
          "nayin": "覆灯火",
          "terrain": "衰",
          "isVoid": false,
          "isDay": false
        }
      ],
      "five": {
        "title": "五行分布",
        "explanation": "柱状高度表示五行在命盘中的相对集中度。该分布不是评分，用于辅助识别元素偏重、相对不足与后续用神 / 忌神判断的背景。",
        "labels": {
          "wood": "木",
          "fire": "火",
          "earth": "土",
          "metal": "金",
          "water": "水"
        },
        "count": {
          "wood": 4,
          "fire": 3,
          "earth": 4,
          "metal": 2,
          "water": 2
        },
        "dominant": "earth",
        "weakest": "water",
        "summary": "土最旺（4） · 水最弱（2） · 五行俱全，但偏弱缺木火"
      },
      "geju": {
        "strengthLabel": "日主旺衰",
        "supportRatioLabel": "助身比",
        "yong": "用神",
        "ji": "忌神",
        "relationsLabel": "合冲刑害破",
        "relationsEmpty": "原局无明显刑冲合害"
      },
      "strengthBand": "偏弱",
      "supportRatio": "0.353",
      "yong": [
        "wood",
        "fire"
      ],
      "ji": [
        "earth",
        "metal",
        "water"
      ],
      "relations": [
        "年柱-日柱六合",
        "月柱-时柱相刑"
      ]
    },
    "dayun": {
      "sectionTitle": "大运排布",
      "explanation": "大运以约十年为一段呈现长期阶段背景。命镜保留完整排盘序列；具体年份的细读交给年镜。",
      "directionLabel": "顺行",
      "startAgeLabel": "7.9 岁起运",
      "introSegments": [
        {
          "text": "这里保留完整大运序列，用作专业命盘结构总览。"
        },
        {
          "text": "当前所在阶段为"
        },
        {
          "text": "观察期",
          "tone": "current"
        },
        {
          "text": "。"
        },
        {
          "text": "年镜负责未来年份细读，命镜只做完整排盘与当前阶段展开。"
        }
      ],
      "currentLabel": "你在这里",
      "highlightLabel": "助力",
      "cols": {
        "age": "虚岁",
        "years": "年份",
        "pillar": "干支",
        "tenGod": "十神",
        "terrain": "十二长生",
        "nature": "性质"
      },
      "distantTitle": "90岁以后 · 远期排盘",
      "distantDescription": "这是大运周期的技术延展，用于保持命盘完整，不代表寿命判断。",
      "distantStartAge": 90,
      "currentIndex": 2,
      "highlightIndex": 3,
      "periods": [
        {
          "pillar": "辛巳",
          "stemElement": "metal",
          "startAge": 9,
          "endAge": 18,
          "startYear": 1998,
          "endYear": 2007,
          "tenGod": "偏财",
          "terrainLabel": "帝旺（峰值）",
          "nature": "watch",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第1步大运",
          "explanation": "偏财当令，外部机会、人情往来和资源流动会更活跃。这一段不适合硬冲，少硬扛、多借力：找到能依靠的人和稳定的结构，比单打独斗更重要。熬过这一段，19 岁后会进入下一轮节奏。十二长生阶段为帝旺（峰值）。 专业上看，这是偏财、帝旺（峰值）、忌的组合。"
        },
        {
          "pillar": "壬午",
          "stemElement": "water",
          "startAge": 19,
          "endAge": 28,
          "startYear": 2008,
          "endYear": 2017,
          "tenGod": "正官",
          "terrainLabel": "临官（成事）",
          "nature": "watch",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第2步大运",
          "explanation": "正官当令，责任、规则、他人的期待都会加重。这一段不适合硬冲，少硬扛、多借力：找到能依靠的人和稳定的结构，比单打独斗更重要。相刑年、六合日。熬过这一段，29 岁后会进入下一轮节奏。十二长生阶段为临官（成事）。 专业上看，这是正官、临官（成事）、忌的组合。"
        },
        {
          "pillar": "癸未",
          "stemElement": "water",
          "startAge": 29,
          "endAge": 38,
          "startYear": 2018,
          "endYear": 2027,
          "tenGod": "七杀",
          "terrainLabel": "冠带（成形）",
          "nature": "watch",
          "favor": "忌",
          "isCurrent": true,
          "isInflection": false,
          "phaseTitle": "当前 · 第3步大运",
          "explanation": "七杀当令，外部压力、竞争和突破欲会更明显。你正在这里，这一段不适合硬冲，少硬扛、多借力：找到能依靠的人和稳定的结构，比单打独斗更重要。六合年。熬过这一段，39 岁后会进入下一轮节奏。十二长生阶段为冠带（成形）。 专业上看，这是七杀、冠带（成形）、忌的组合。"
        },
        {
          "pillar": "甲申",
          "stemElement": "wood",
          "startAge": 39,
          "endAge": 48,
          "startYear": 2028,
          "endYear": 2037,
          "tenGod": "正印",
          "terrainLabel": "沐浴（调整）",
          "nature": "supportive",
          "favor": "喜",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第4步大运",
          "explanation": "正印当令，贵人、学习、凭证和系统性保护会更显眼。这一段更容易借到顺势的力量，适合把资源、能力和稳定关系往前推。三合月、三合时。熬过这一段，49 岁后会进入下一轮节奏。十二长生阶段为沐浴（调整）。 专业上看，这是正印、沐浴（调整）、喜的组合。"
        },
        {
          "pillar": "乙酉",
          "stemElement": "wood",
          "startAge": 49,
          "endAge": 58,
          "startYear": 2038,
          "endYear": 2047,
          "tenGod": "偏印",
          "terrainLabel": "长生（生发）",
          "nature": "supportive",
          "favor": "喜",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第5步大运",
          "explanation": "偏印当令，灵感、转向、独立判断和非标准路径会变多。这一段更容易借到顺势的力量，适合把资源、能力和稳定关系往前推。六合月、六合时。熬过这一段，59 岁后会进入下一轮节奏。十二长生阶段为长生（生发）。 专业上看，这是偏印、长生（生发）、喜的组合。"
        },
        {
          "pillar": "丙戌",
          "stemElement": "fire",
          "startAge": 59,
          "endAge": 68,
          "startYear": 2048,
          "endYear": 2057,
          "tenGod": "劫财",
          "terrainLabel": "养（培育）",
          "nature": "supportive",
          "favor": "喜",
          "isCurrent": false,
          "isInflection": true,
          "phaseTitle": "第6步大运",
          "explanation": "劫财当令，合作、分配、竞争和资源争夺会更需要分寸。这一段更容易借到顺势的力量，适合把资源、能力和稳定关系往前推。三合年、相冲月、相刑日、相冲时。熬过这一段，69 岁后会进入下一轮节奏。十二长生阶段为养（培育）。 专业上看，这是劫财、养（培育）、喜的组合。"
        },
        {
          "pillar": "丁亥",
          "stemElement": "fire",
          "startAge": 69,
          "endAge": 78,
          "startYear": 2058,
          "endYear": 2067,
          "tenGod": "比肩",
          "terrainLabel": "胎（酝酿）",
          "nature": "supportive",
          "favor": "喜",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第7步大运",
          "explanation": "比肩当令，自主性、同辈竞争和自我边界会被推到前面。这一段更容易借到顺势的力量，适合把资源、能力和稳定关系往前推。三合日。熬过这一段，79 岁后会进入下一轮节奏。十二长生阶段为胎（酝酿）。 专业上看，这是比肩、胎（酝酿）、喜的组合。"
        },
        {
          "pillar": "戊子",
          "stemElement": "earth",
          "startAge": 79,
          "endAge": 88,
          "startYear": 2068,
          "endYear": 2077,
          "tenGod": "伤官",
          "terrainLabel": "绝（断旧）",
          "nature": "blocked",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第8步大运",
          "explanation": "伤官当令，自我表达、反规则意识和技术锋芒会更突出。这一段阻力更重，先守住边界与节奏，少做高风险扩张。相冲年、三合月、相害日、三合时。熬过这一段，89 岁后会进入下一轮节奏。十二长生阶段为绝（断旧）。 专业上看，这是伤官、绝（断旧）、忌的组合。"
        },
        {
          "pillar": "己丑",
          "stemElement": "earth",
          "startAge": 89,
          "endAge": 98,
          "startYear": 2078,
          "endYear": 2087,
          "tenGod": "食神",
          "terrainLabel": "墓（收藏）",
          "nature": "blocked",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": true,
          "phaseTitle": "第9步大运",
          "explanation": "食神当令，表达、产出、照顾感和稳定创造力会被放大。这一段阻力更重，先守住边界与节奏，少做高风险扩张。相害年、相破月、相冲日、相破时。熬过这一段，99 岁后会进入下一轮节奏。十二长生阶段为墓（收藏）。 专业上看，这是食神、墓（收藏）、忌的组合。"
        },
        {
          "pillar": "庚寅",
          "stemElement": "metal",
          "startAge": 99,
          "endAge": 108,
          "startYear": 2088,
          "endYear": 2097,
          "tenGod": "正财",
          "terrainLabel": "死（收束）",
          "nature": "watch",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第10步大运",
          "explanation": "正财当令，学习如何稳定经营资源、关系和现实秩序。这一段不适合硬冲，少硬扛、多借力：找到能依靠的人和稳定的结构，比单打独斗更重要。三合年。熬过这一段，109 岁后会进入下一轮节奏。“死”是十二长生的阶段名，表示气机收束、旧模式退场，不是死亡或寿命判断。 专业上看，这是正财、死（收束）、忌的组合。"
        },
        {
          "pillar": "辛卯",
          "stemElement": "metal",
          "startAge": 109,
          "endAge": 118,
          "startYear": 2098,
          "endYear": 2107,
          "tenGod": "偏财",
          "terrainLabel": "病（失衡）",
          "nature": "watch",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第11步大运",
          "explanation": "偏财当令，外部机会、人情往来和资源流动会更活跃。这一段不适合硬冲，少硬扛、多借力：找到能依靠的人和稳定的结构，比单打独斗更重要。相破年、相害月、三合日、相害时。熬过这一段，119 岁后会进入下一轮节奏。十二长生阶段为病（失衡）。 专业上看，这是偏财、病（失衡）、忌的组合。"
        },
        {
          "pillar": "壬辰",
          "stemElement": "water",
          "startAge": 119,
          "endAge": 128,
          "startYear": 2108,
          "endYear": 2117,
          "tenGod": "正官",
          "terrainLabel": "衰（回落）",
          "nature": "watch",
          "favor": "忌",
          "isCurrent": false,
          "isInflection": false,
          "phaseTitle": "第12步大运",
          "explanation": "正官当令，责任、规则、他人的期待都会加重。这一段不适合硬冲，少硬扛、多借力：找到能依靠的人和稳定的结构，比单打独斗更重要。相刑月、相刑时。十二长生阶段为衰（回落）。 专业上看，这是正官、衰（回落）、忌的组合。"
        }
      ]
    },
    "liunian": {
      "title": "流年关键窗口",
      "intro": "这里不是给每一年打分，而是把未来几年中最需要提前安排的时间段拎出来。",
      "explanation": "颜色表示这一段的整体倾向：适合主动推进、稳步积累、放缓观察、守住边界或处理转折。干支、合冲与用神关系只作为算法依据，不是命运分数。",
      "horizonLabel": "未来窗口 2026–2038 年",
      "yearsLabel": "涉及年份",
      "detailToggle": "查看算法依据",
      "evidenceLabel": "为什么被标出来",
      "dayunLabel": "背景大运",
      "salienceLabels": {
        "high": "优先关注",
        "medium": "留意即可"
      },
      "favorLabels": {
        "喜": "顺势证据",
        "忌": "阻力证据",
        "平": "中性证据"
      },
      "relationMore": "另有 {count} 项关系",
      "basisMore": "另有 {count} 条依据",
      "empty": "未来窗口内暂无特别需要关注的流年。",
      "windows": [
        {
          "range": "2026–2027 年",
          "nature": "supportive",
          "favor": "喜",
          "salience": "high",
          "badge": "机会窗口",
          "plain": "能量顺、机会多，是这几年里值得主动把握的窗口。流年五行正是命局所喜，做事顺手、借得上力。流年与日支相合，事情多通过合作与人际关系牵动。适合推进事业、启动计划，做长期布局。",
          "pillars": [
            {
              "year": 2026,
              "ganzhi": "丙午"
            },
            {
              "year": 2027,
              "ganzhi": "丁未"
            }
          ],
          "dayunPillar": "癸未",
          "relations": [
            "六合日"
          ],
          "basis": [
            "喜用得力",
            "合日支"
          ]
        },
        {
          "range": "2028–2029 年",
          "nature": "blocked",
          "favor": "忌",
          "salience": "high",
          "badge": "留意阻力",
          "plain": "阻力与摩擦偏多，人际或健康容易有波动。期间恰逢大运交接，长期气场正在转换，前后几年的感受会有明显差别。这几年流年正是命局所忌、且力量集中，阻滞感会比平时明显。宜守成、稳住节奏，避免重大投资与冒险决定。",
          "pillars": [
            {
              "year": 2028,
              "ganzhi": "戊申"
            },
            {
              "year": 2029,
              "ganzhi": "己酉"
            }
          ],
          "dayunPillar": "甲申",
          "relations": [
            "三合月",
            "六合月"
          ],
          "basis": [
            "忌神当值",
            "交大运"
          ]
        },
        {
          "range": "2030–2033 年",
          "nature": "watch",
          "favor": "忌",
          "salience": "high",
          "badge": "放缓观察",
          "plain": "节奏放缓的过渡期，适合放慢脚步。流年冲动月令提纲，牵动的是环境与发展方向，变化往往来得比较大。流年直冲日支，变动感集中在自身状态与身边亲近关系上。流年与日支相合，事情多通过合作与人际关系牵动。宜观察、修整与积累，不宜冒进；把这段时间用好，是在为下一轮蓄力。",
          "pillars": [
            {
              "year": 2030,
              "ganzhi": "庚戌"
            },
            {
              "year": 2031,
              "ganzhi": "辛亥"
            },
            {
              "year": 2032,
              "ganzhi": "壬子"
            },
            {
              "year": 2033,
              "ganzhi": "癸丑"
            }
          ],
          "dayunPillar": "甲申",
          "relations": [
            "相刑日",
            "相冲月",
            "三合日",
            "相害日",
            "三合月",
            "相冲日",
            "相破月"
          ],
          "basis": [
            "冲提纲",
            "忌神",
            "逢刑",
            "合日支",
            "冲日支"
          ]
        },
        {
          "range": "2034–2037 年",
          "nature": "supportive",
          "favor": "喜",
          "salience": "high",
          "badge": "机会窗口",
          "plain": "能量顺、机会多，是这几年里值得主动把握的窗口。流年五行正是命局所喜，做事顺手、借得上力。流年与日支相合，事情多通过合作与人际关系牵动。流年逢刑，过程中容易有磕绊、口舌或反复，重要的事多留一手。适合推进事业、启动计划，做长期布局。",
          "pillars": [
            {
              "year": 2034,
              "ganzhi": "甲寅"
            },
            {
              "year": 2035,
              "ganzhi": "乙卯"
            },
            {
              "year": 2036,
              "ganzhi": "丙辰"
            },
            {
              "year": 2037,
              "ganzhi": "丁巳"
            }
          ],
          "dayunPillar": "甲申",
          "relations": [
            "三合日",
            "相害月",
            "相刑月"
          ],
          "basis": [
            "喜用得力",
            "合日支",
            "逢刑"
          ]
        },
        {
          "range": "2038 年",
          "nature": "blocked",
          "favor": "忌",
          "salience": "high",
          "badge": "留意阻力",
          "plain": "阻力与摩擦偏多，人际或健康容易有波动。期间恰逢大运交接，长期气场正在转换，前后几年的感受会有明显差别。这几年流年正是命局所忌、且力量集中，阻滞感会比平时明显。流年与日支相合，事情多通过合作与人际关系牵动。宜守成、稳住节奏，避免重大投资与冒险决定。",
          "pillars": [
            {
              "year": 2038,
              "ganzhi": "戊午"
            }
          ],
          "dayunPillar": "乙酉",
          "relations": [
            "六合日"
          ],
          "basis": [
            "忌神当值",
            "合日支",
            "交大运"
          ]
        }
      ]
    },
    "events": {
      "title": "用过去的事，校准这张盘",
      "intro": "记录已发生的重要事件（工作、关系、迁移、重大决定等），用于在时间轴上查看其对应的大运与流年位置。",
      "explanation": "历史事件会映射到大运和流年位置，用于检查事件发生时间与命盘阶段之间的对应关系。该记录只影响解释依据，不改写排盘结果。",
      "dateLabel": "发生日期",
      "datePlaceholder": "yyyy/mm/dd",
      "bodyLabel": "事件",
      "bodyPlaceholder": "例如:换工作、重要关系开始或结束、搬迁、重大决定…",
      "add": "记录事件",
      "invalidHint": "请填写日期与事件内容。",
      "empty": "还没有记录历史事件。记录后即可看到它落在命盘时间轴的位置。",
      "delete": "删除",
      "dayunColumn": "大运",
      "liunianColumn": "流年",
      "preGenHint": "以下为确定性时间轴定位;生成解读后,AI 会结合这些经历给出更贴合的叙述。",
      "items": [
        {
          "id": "evt-1",
          "date": "2013-07-01",
          "body": "大学毕业，进入第一家公司做产品",
          "resonance": {
            "dayunPillar": "壬午",
            "dayunTenGod": "正官",
            "dayunNature": "watch",
            "liunianPillar": "癸巳",
            "liunianNature": "watch"
          }
        },
        {
          "id": "evt-2",
          "date": "2018-03-15",
          "body": "搬到上海，开始一段长期关系",
          "resonance": {
            "dayunPillar": "癸未",
            "dayunTenGod": "七杀",
            "dayunNature": "watch",
            "liunianPillar": "戊戌",
            "liunianNature": "blocked"
          }
        },
        {
          "id": "evt-3",
          "date": "2022-10-08",
          "body": "离职创业，和两位朋友一起做工作室",
          "resonance": {
            "dayunPillar": "癸未",
            "dayunTenGod": "七杀",
            "dayunNature": "watch",
            "liunianPillar": "壬寅",
            "liunianNature": "watch"
          }
        }
      ]
    },
    "reading": {
      "eyebrow": "AI 解读 · 结合你记录的历史",
      "coreTitle": "命局核心特点与长期策略",
      "explanation": "该模块调用 Runtime AI，将确定性命盘、阶段结构与已记录事件转写为结构化解读。运行失败时显示失败状态，不生成替代内容。",
      "coreLabels": {
        "personality": "性格底色",
        "strengths": "优势能力",
        "long_term_themes": "长期课题",
        "relationship_pattern": "关系模式",
        "career_inclination": "事业倾向"
      },
      "strategiesTitle": "长期阶段策略",
      "output": {
        "summary": "丁火生于辰月，木火偏弱而土金水偏重，属身弱伤官格。你天生有表达与巧思，但容易把力气花在证明自己上；当前癸未大运七杀当令，压力集中，也在逼你建立能依靠的结构。2022 年离职创业正落在这段七杀运里，辛苦但成形。39 岁后转入甲申、乙酉印运，木来生火，是把前十年的历练变成事业与名声的窗口。",
        "core": {
          "personality": "温和专注、心思细，对细节和质感有天然敏感度；表达欲强，遇到看不惯的事不愿将就，容易在小处较真。",
          "strengths": "伤官带才气：文字、设计、教学、产品这类需要把想法讲清楚的工作最能发挥；年月正财透干，务实、能守、有耐心把一件事做完整。",
          "long_term_themes": "身弱借力是一生的课题：学会找靠山、进系统、借团队的力，而不是单打独斗；把「被认可」的需要，换成「把事做成」的目标。",
          "relationship_pattern": "年日六合，与长辈、伴侣缘分深，家人是重要的支撑来源；月时相刑提示合伙与合作关系需要提前讲清边界和分配。",
          "career_inclination": "适合内容、教育、咨询与产品方向。2028 年起印运到来，学历、资质、平台会成为放大器，适合在那之前把作品和口碑攒够。"
        },
        "strategies": [
          {
            "pillar": "癸未",
            "ageRange": "29–38",
            "theme": "七杀当令 · 借力成事",
            "strategy": "创业阶段别硬扛：把合伙关系、股权和分工写清楚，找到一两位能依靠的前辈或顾问。2026–2027 年流年喜用得力，是这段运里最值得推一把的两年。"
          },
          {
            "pillar": "甲申",
            "ageRange": "39–48",
            "theme": "正印扶身 · 立业窗口",
            "strategy": "木印生火，贵人、平台与资质开始起作用。适合把工作室的方法论沉淀成课程、书或产品，让名声替你工作；2028–2029 年交运之际先稳后进。"
          },
          {
            "pillar": "乙酉",
            "ageRange": "49–58",
            "theme": "偏印巧思 · 转型深耕",
            "strategy": "偏印带来另辟蹊径的能力，适合从执行者转向指导者、投资人或研究者。2034–2037 年是又一个机会窗口，可以为下一阶段的身份提前布局。"
          }
        ]
      }
    },
    "rectifyEntry": "对结果存疑？用人生中的大事，反推并校正你的出生时辰 →"
  },
  "ziwei": {
    "copy": {
      "personaMark": "命",
      "personaTitle": "本人命盘",
      "personaSubtitle": "命主 · 紫微本命盘",
      "chartTitle": "紫微命盘",
      "chartHint": "点击宫位查看星曜详情",
      "centralEyebrow": "ZIWEI · 三合派",
      "emptyPalace": "空宫",
      "minorStars": "辅曜",
      "majorStars": "主星",
      "palaceDetailEyebrow": "PALACE DETAIL",
      "stemBranchLabel": "干支",
      "sihuaLabel": "四化",
      "interpretationTitle": "宫位解读",
      "decadeTitle": "大限指引",
      "decadeEmpty": "生成解读后，这里会显示该大限的主题与行动建议。",
      "soulRole": "命主宫",
      "bodyRole": "身宫",
      "selectedRole": "当前查看",
      "basis": {
        "soulPalace": "命宫",
        "bodyPalace": "身宫",
        "fiveElements": "五行局",
        "soulStar": "命主",
        "bodyStar": "身主",
        "palaces": "宫数"
      },
      "astrolabeAria": "紫微十二宫命盘",
      "briefAria": "紫微命镜解读",
      "briefEyebrow": "NATAL BRIEF",
      "briefTitle": "命格综述",
      "profileLabels": {
        "life_pattern": "生命格局",
        "strengths": "核心优势",
        "long_term_theme": "长期主题",
        "relationship_pattern": "情感模式",
        "career_inclination": "事业倾向"
      },
      "profileNumerals": {
        "life_pattern": "壹",
        "strengths": "贰",
        "long_term_theme": "叁",
        "relationship_pattern": "肆",
        "career_inclination": "伍"
      }
    },
    "basis": {
      "soulPalace": "命宫",
      "bodyPalace": "财帛",
      "fiveElementsClass": "火六局",
      "soulStar": "贪狼",
      "bodyStar": "火星",
      "palaceCount": 12
    },
    "palaces": [
      {
        "index": 0,
        "name": "福德",
        "stem": "戊",
        "branch": "寅",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "天机",
            "brightness": "得",
            "mutagen": ""
          },
          {
            "name": "太阴",
            "brightness": "旺",
            "mutagen": "科"
          }
        ],
        "minor": [],
        "startAge": 26,
        "endAge": 35
      },
      {
        "index": 1,
        "name": "田宅",
        "stem": "己",
        "branch": "卯",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "紫微",
            "brightness": "旺",
            "mutagen": ""
          },
          {
            "name": "贪狼",
            "brightness": "利",
            "mutagen": ""
          }
        ],
        "minor": [
          {
            "name": "地劫",
            "brightness": "",
            "mutagen": ""
          }
        ],
        "startAge": 36,
        "endAge": 45
      },
      {
        "index": 2,
        "name": "官禄",
        "stem": "庚",
        "branch": "辰",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "巨门",
            "brightness": "陷",
            "mutagen": ""
          }
        ],
        "minor": [],
        "startAge": 46,
        "endAge": 55
      },
      {
        "index": 3,
        "name": "仆役",
        "stem": "辛",
        "branch": "巳",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "天相",
            "brightness": "得",
            "mutagen": ""
          }
        ],
        "minor": [
          {
            "name": "火星",
            "brightness": "得",
            "mutagen": ""
          }
        ],
        "startAge": 56,
        "endAge": 65
      },
      {
        "index": 4,
        "name": "迁移",
        "stem": "壬",
        "branch": "午",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "天梁",
            "brightness": "庙",
            "mutagen": ""
          }
        ],
        "minor": [
          {
            "name": "左辅",
            "brightness": "",
            "mutagen": ""
          },
          {
            "name": "文昌",
            "brightness": "陷",
            "mutagen": ""
          }
        ],
        "startAge": 66,
        "endAge": 75
      },
      {
        "index": 5,
        "name": "疾厄",
        "stem": "癸",
        "branch": "未",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "廉贞",
            "brightness": "利",
            "mutagen": ""
          },
          {
            "name": "七杀",
            "brightness": "庙",
            "mutagen": ""
          }
        ],
        "minor": [
          {
            "name": "天钺",
            "brightness": "",
            "mutagen": ""
          },
          {
            "name": "地空",
            "brightness": "",
            "mutagen": ""
          },
          {
            "name": "铃星",
            "brightness": "利",
            "mutagen": ""
          },
          {
            "name": "陀罗",
            "brightness": "庙",
            "mutagen": ""
          }
        ],
        "startAge": 76,
        "endAge": 85
      },
      {
        "index": 6,
        "name": "财帛",
        "stem": "甲",
        "branch": "申",
        "isSoul": false,
        "isBody": true,
        "major": [],
        "minor": [
          {
            "name": "右弼",
            "brightness": "",
            "mutagen": ""
          },
          {
            "name": "文曲",
            "brightness": "得",
            "mutagen": ""
          },
          {
            "name": "禄存",
            "brightness": "",
            "mutagen": ""
          },
          {
            "name": "天马",
            "brightness": "",
            "mutagen": ""
          }
        ],
        "startAge": 86,
        "endAge": 95
      },
      {
        "index": 7,
        "name": "子女",
        "stem": "乙",
        "branch": "酉",
        "isSoul": false,
        "isBody": false,
        "major": [],
        "minor": [
          {
            "name": "擎羊",
            "brightness": "陷",
            "mutagen": ""
          }
        ],
        "startAge": 96,
        "endAge": 105
      },
      {
        "index": 8,
        "name": "夫妻",
        "stem": "丙",
        "branch": "戌",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "天同",
            "brightness": "平",
            "mutagen": "忌"
          }
        ],
        "minor": [],
        "startAge": 106,
        "endAge": 115
      },
      {
        "index": 9,
        "name": "兄弟",
        "stem": "丁",
        "branch": "亥",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "武曲",
            "brightness": "平",
            "mutagen": "权"
          },
          {
            "name": "破军",
            "brightness": "平",
            "mutagen": ""
          }
        ],
        "minor": [],
        "startAge": 116,
        "endAge": 125
      },
      {
        "index": 10,
        "name": "命宫",
        "stem": "戊",
        "branch": "子",
        "isSoul": true,
        "isBody": false,
        "major": [
          {
            "name": "太阳",
            "brightness": "陷",
            "mutagen": "禄"
          }
        ],
        "minor": [],
        "startAge": 6,
        "endAge": 15
      },
      {
        "index": 11,
        "name": "父母",
        "stem": "己",
        "branch": "丑",
        "isSoul": false,
        "isBody": false,
        "major": [
          {
            "name": "天府",
            "brightness": "庙",
            "mutagen": ""
          }
        ],
        "minor": [
          {
            "name": "天魁",
            "brightness": "",
            "mutagen": ""
          }
        ],
        "startAge": 16,
        "endAge": 25
      }
    ],
    "palaceDomains": {
      "命宫": {
        "tagline": "自我 · 人生主轴",
        "scope": "命宫看你的本命底色、做决定的惯性，以及你如何把自己放进人生主轴。",
        "boundary": "它不是给人格贴死标签，而是提示你更容易用哪种方式启动人生议题。"
      },
      "兄弟": {
        "tagline": "同辈 · 横向协作",
        "scope": "兄弟宫看手足、同辈与平级协作，也看你如何处理横向支持和竞争。",
        "boundary": "它提示平级关系的运行方式，而非断定谁一定帮你或拖累你。"
      },
      "夫妻": {
        "tagline": "亲密 · 长期关系",
        "scope": "夫妻宫看亲密关系、长期伴侣与深度合作，以及你面对承诺和相处节奏的方式。",
        "boundary": "它提示你在长期关系里的课题，而不是匹配分数或婚恋结论。"
      },
      "子女": {
        "tagline": "晚辈 · 创作承接",
        "scope": "子女宫看你与子女、晚辈、学生及作品延续之间的互动，以及照护责任如何进入生活节奏。",
        "boundary": "它提示你与下一代和延续性作品的关系主题，不是生育数量或必然事件。"
      },
      "财帛": {
        "tagline": "金钱 · 资源安全感",
        "scope": "财帛宫看金钱、收入方式与资源使用习惯，也看你如何感知安全感与交换价值。",
        "boundary": "它提示你经营资源和安全感的主旋律，而非预测财富数额。"
      },
      "疾厄": {
        "tagline": "身心 · 压力节律",
        "scope": "疾厄宫看身体节律、压力承载与恢复能力，也看你如何照顾自己。",
        "boundary": "它提示身心节律与压力管理的主题，并非医学诊断。"
      },
      "迁移": {
        "tagline": "外部 · 远行机会",
        "scope": "迁移宫看外部环境、远行、迁居与离开熟悉场域后的表现。",
        "boundary": "它提示你面对外部世界的展开方式，而非一定离乡或迁居。"
      },
      "仆役": {
        "tagline": "团队 · 人际网络",
        "scope": "仆役宫看朋友、团队、下属与合作网络，也看你如何选择同行者。",
        "boundary": "它提示你在群体关系中的合作模式，而非人脉多少的排名。"
      },
      "官禄": {
        "tagline": "事业 · 社会角色",
        "scope": "官禄宫看事业、职责、专业路径与社会角色，也看你如何承担被看见的任务。",
        "boundary": "它提示你适合如何经营长期事业角色，而非给出职业清单。"
      },
      "田宅": {
        "tagline": "家宅 · 内在安顿",
        "scope": "田宅宫看居所、家庭基底、私域空间与安定感来源。",
        "boundary": "它提示你与家宅和内在安顿的关系，而非判断房产数量。"
      },
      "福德": {
        "tagline": "精神 · 内在能量",
        "scope": "福德宫看精神余裕、休息方式与独处时的能量恢复。",
        "boundary": "它提示你如何养护内在能量，而非衡量快乐指数。"
      },
      "父母": {
        "tagline": "原生家庭 · 权威课题",
        "scope": "父母宫看父母、长辈、师长与制度资源，以及早年承接的规则感。",
        "boundary": "它提示长辈与制度资源如何影响你的节奏，而非断定亲缘好坏。"
      }
    },
    "defaultPalaceDomain": {
      "tagline": "人生方向 · 关系场域",
      "scope": "这个宫位显示你在这一人生方向里的自然反应、投入方式与需要经营的关系。",
      "boundary": "它提示这个宫位在你命盘里的长期主题，而非单点断语或必然事件。"
    },
    "reading": {
      "summary": "命宫在子，太阳陷宫化禄，命主贪狼、身主火星，火六局。你是低调发光的一类人：不靠张扬取胜，靠持续输出与关系经营。身宫落财帛，人生下半场的重心会自然转向资源与安全感；36–45 岁走田宅大限，紫微贪狼同度，是置业与积累最扎实的十年。",
      "profile": {
        "life_pattern": "太阳化禄坐命，虽陷而有禄，主为人厚道、乐于照亮他人，但不擅长为自己争；紫微贪狼在田宅，家宅根基与人脉资源是你真正的底盘。",
        "strengths": "天机、太阴化科在福德，心思缜密、学习力强，擅长把复杂问题拆细；文曲、禄存、天马同守身宫财帛，口才、理财与机动性兼备。",
        "long_term_theme": "太阳落陷是一生功课：不必急着被看见，把光用在少数真正重要的人和事上，效果反而更长久。",
        "relationship_pattern": "夫妻宫天同化忌，对亲密关系要求高、容易患得患失；你需要的是稳定的陪伴而非激情，关系里要练习把不安说出口。",
        "career_inclination": "官禄巨门独坐，适合以口才、研究、法律、咨询立身，越专越稳；46–55 岁官禄大限是专业声望的兑现期。"
      },
      "decadeGuidance": [
        {
          "ageRange": "26-35",
          "palaceName": "福德",
          "theme": "天机太阴 · 先安顿内心",
          "strategy": "这十年的关键词是学习与内耗并存：把精力放在积累方法和作品上，别让敏感变成反复自我怀疑。"
        },
        {
          "ageRange": "36-45",
          "palaceName": "田宅",
          "theme": "紫微贪狼 · 置业与积累",
          "strategy": "人脉与资源开始向你聚拢，适合安家、置业，并把工作室做成可持续的事业；地劫同宫，投资要守住底线。"
        },
        {
          "ageRange": "46-55",
          "palaceName": "官禄",
          "theme": "巨门独坐 · 以专业立身",
          "strategy": "专业声望的兑现期：多用口才与研究能力，少用人情；把话讲清楚、把边界守住，就是这十年最好的策略。"
        },
        {
          "ageRange": "6-15",
          "palaceName": "命宫",
          "theme": "太阳化禄 · 早年底色",
          "strategy": "早年养成了乐于付出、不争不抢的底色，这份厚道是你日后所有关系的起点。"
        }
      ]
    }
  },
  "qizheng": {
    "copy": {
      "heroEyebrow": "本命 · 命格概览",
      "favorableTitle": "天生得力 · 可借的星",
      "watchTitle": "宜节制 · 要留心",
      "basisTitle": "出生星盘 · 基准",
      "viewIntro": "默认用白话讲清楚每颗星、每个宫位的含义；想看原始星盘数据，右侧切到「看数据」。",
      "viewPlain": "读得懂",
      "viewData": "看数据",
      "viewToggleAria": "切换白话解读与原始数据",
      "explainerTitle": "这套算法在看什么",
      "explainerBody": "七政四余，又叫果老星宗，是中国传统的星象命理。它把你出生那一刻头顶的星空，投影成一张盘：看十一颗星曜分别落在代表人生不同领域的十二个宫位里，从而读出你的天赋、课题与节奏。",
      "qizhengCardTitle": "七颗真实的星",
      "qizhengCardBody": "太阳 · 太阴 · 辰星 · 太白 · 荧惑 · 岁星 · 镇星（日月，加金木水火土五星）",
      "siyuCardTitle": "四颗看不见的虚星",
      "siyuCardBody": "罗喉 · 计都 · 月孛 · 紫气（由月亮轨道等推算的隐线索）",
      "explainerHint": "虚线词都可以悬停或点一下看解释。专业术语已就近标注。",
      "chartTitle": "命盘星图",
      "chartHint": "点任意宫位，看它代表的人生领域与解读",
      "wheelCenterEyebrow": "命主 · 你本人",
      "deepTitle": "深入解读",
      "starsTitle": "十一星曜 · 逐颗读",
      "starsHint": "每颗星管什么、落在哪、力道如何 — 点开看长解读",
      "starGoPalace": "落",
      "patternsTitle": "重点格局",
      "patternsHint": "这张盘里最值得先看的几件事",
      "basisSectionTitle": "星盘依据",
      "basisSectionHint": "这张盘是怎么起出来的 — 术语可悬停查看",
      "ctaEyebrow": "七政四余 / 果老星宗",
      "ctaTitle": "生成你的本命星曜简析",
      "ctaBody": "基于本命星盘与你记录的历史事件，生成核心特点与长期阶段策略。",
      "ctaButton": "生成命镜解读",
      "readingTitleSuffix": "命镜解读",
      "emptyDetail": "没有星曜进驻",
      "terms": {
        "mingZhu": "命主",
        "qizheng": "七政",
        "siyu": "四余",
        "emptyHouse": "空宫"
      },
      "chartAria": "七政四余命镜星盘依据",
      "bodiesTitle": "七政四余落宫",
      "housesTitle": "十二宫分布",
      "emptyHouse": "空宫",
      "bodyColumns": {
        "body": "星曜",
        "house": "宫位",
        "mansion": "宿",
        "position": "宫势",
        "longitude": "黄道度"
      },
      "readingAria": "七政四余命镜解读",
      "starGuidanceTitle": "星曜长期提示",
      "profileLabels": {
        "life_pattern": "生命格局",
        "strengths": "优势能力",
        "long_term_theme": "长期课题",
        "relationship_pattern": "关系模式",
        "career_inclination": "事业倾向"
      }
    },
    "hero": {
      "title": "以情为镜",
      "subtitleChips": [
        "命主岁星",
        "财帛聚两曜",
        "岁星守夫妻"
      ],
      "oneLiner": "命主落在夫妻——亲密关系是你照见自己的镜子，你在一对一的深度联结里活得最完整。",
      "paragraph": "十一颗星里，有 2 颗聚在掌管「钱财与资源」的财帛宫，命主岁星落在夫妻宫，定下你性格的主线；岁星又以全盘七强之势坐夫妻，是这张盘最得力的一颗。要留心的是疾厄宫压着计都，别把内耗当常态。",
      "favorable": [
        "岁星 · 七强",
        "太阳",
        "太阴"
      ],
      "watch": [
        "太白 · 闲宫"
      ],
      "basisLabel": "昼盘 · 上升 254.82°",
      "mingZhuLabel": "岁星"
    },
    "stars": [
      {
        "key": "taiyang",
        "label": "太阳",
        "planet": "日 · 太阳",
        "element": "火",
        "color": "#d06a59",
        "bg": "#d06a5922",
        "essence": "主体之光、外在身份与事业舞台，也代表父亲。",
        "houseName": "男女",
        "mansion": "亢",
        "strength": "次强",
        "strengthLabel": "次强",
        "degree": "21.85°",
        "kind": "qizheng",
        "isMing": false,
        "deep": "主体之光、外在身份与事业舞台，也代表父亲。它落在掌管「子女与创作」的男女宫，宫势次强、稳定可用。"
      },
      {
        "key": "taiyin",
        "label": "太阴",
        "planet": "月 · 太阴",
        "element": "水",
        "color": "#5a8ec0",
        "bg": "#5a8ec022",
        "essence": "情绪与内心、母亲，以及身体的安定感。",
        "houseName": "福德",
        "mansion": "昴",
        "strength": "次强",
        "strengthLabel": "次强",
        "degree": "222.54°",
        "kind": "qizheng",
        "isMing": false,
        "deep": "情绪与内心、母亲，以及身体的安定感。它落在掌管「内心与精神世界」的福德宫，宫势次强、稳定可用。"
      },
      {
        "key": "chenxing",
        "label": "辰星",
        "planet": "水星",
        "element": "水",
        "color": "#5a8ec0",
        "bg": "#5a8ec022",
        "essence": "思维、表达、学习与沟通的那根线。",
        "houseName": "男女",
        "mansion": "房",
        "strength": "次强",
        "strengthLabel": "次强",
        "degree": "41.17°",
        "kind": "qizheng",
        "isMing": false,
        "deep": "思维、表达、学习与沟通的那根线。它落在掌管「子女与创作」的男女宫，宫势次强、稳定可用。"
      },
      {
        "key": "taibai",
        "label": "太白",
        "planet": "金星",
        "element": "金",
        "color": "#8f9b53",
        "bg": "#8f9b5322",
        "essence": "情感、审美、人缘与钱财的甜味。",
        "houseName": "兄弟",
        "mansion": "翼",
        "strength": "闲宫",
        "strengthLabel": "闲宫",
        "degree": "335.86°",
        "kind": "qizheng",
        "isMing": false,
        "deep": "情感、审美、人缘与钱财的甜味。它落在掌管「手足与同辈」的兄弟宫，宫势属闲宫、力道偏淡。"
      },
      {
        "key": "yinghuo",
        "label": "荧惑",
        "planet": "火星",
        "element": "火",
        "color": "#d06a59",
        "bg": "#d06a5922",
        "essence": "行动力、冲劲、脾气与争斗心。",
        "houseName": "兄弟",
        "mansion": "张",
        "strength": "闲宫",
        "strengthLabel": "闲宫",
        "degree": "323.34°",
        "kind": "qizheng",
        "isMing": false,
        "deep": "行动力、冲劲、脾气与争斗心。它落在掌管「手足与同辈」的兄弟宫，宫势属闲宫、力道偏淡。"
      },
      {
        "key": "suixing",
        "label": "岁星",
        "planet": "木星",
        "element": "木",
        "color": "#5d9c69",
        "bg": "#5d9c6922",
        "essence": "扩展、机会、信念与贵人的来路。",
        "houseName": "夫妻",
        "mansion": "斗",
        "strength": "七强",
        "strengthLabel": "七强",
        "degree": "94.07°",
        "kind": "qizheng",
        "isMing": true,
        "deep": "扩展、机会、信念与贵人的来路。它落在掌管「伴侣与亲密关系」的夫妻宫，宫势七强、最为得位。作为你的命主星，它代表「你本人」那条主线，是看盘的第一落点。"
      },
      {
        "key": "zhenxing",
        "label": "镇星",
        "planet": "土星",
        "element": "土",
        "color": "#c0902e",
        "bg": "#c0902e22",
        "essence": "责任、积累、根基与耐力的硬底。",
        "houseName": "财帛",
        "mansion": "鬼",
        "strength": "次强",
        "strengthLabel": "次强",
        "degree": "294.91°",
        "kind": "qizheng",
        "isMing": false,
        "deep": "责任、积累、根基与耐力的硬底。它落在掌管「钱财与资源」的财帛宫，宫势次强、稳定可用。"
      },
      {
        "key": "luohou",
        "label": "罗喉",
        "planet": "四余 · 虚星",
        "element": "火",
        "color": "#d06a59",
        "bg": "#d06a5922",
        "essence": "放大与执念，被无形牵引去做的事。",
        "houseName": "财帛",
        "mansion": "星",
        "strength": "次强",
        "strengthLabel": "次强",
        "degree": "313.11°",
        "kind": "siyu",
        "isMing": false,
        "deep": "放大与执念，被无形牵引去做的事。它落在掌管「钱财与资源」的财帛宫，宫势次强、稳定可用。它是四余虚星，本身无吉凶，关键看你怎么用。"
      },
      {
        "key": "jidu",
        "label": "计都",
        "planet": "四余 · 虚星",
        "element": "土",
        "color": "#c0902e",
        "bg": "#c0902e22",
        "essence": "断舍与突变，旧的东西被悄悄收走。",
        "houseName": "疾厄",
        "mansion": "虚",
        "strength": "次强",
        "strengthLabel": "次强",
        "degree": "133.11°",
        "kind": "siyu",
        "isMing": false,
        "deep": "断舍与突变，旧的东西被悄悄收走。它落在掌管「身体与压力」的疾厄宫，宫势次强、稳定可用。它是四余虚星，本身无吉凶，关键看你怎么用。"
      },
      {
        "key": "ziqi",
        "label": "紫气",
        "planet": "四余 · 虚星",
        "element": "木",
        "color": "#5d9c69",
        "bg": "#5d9c6922",
        "essence": "吉庆、格调，化解凶险的那点好运余光。",
        "houseName": "相貌",
        "mansion": "毕",
        "strength": "闲宫",
        "strengthLabel": "闲宫",
        "degree": "234.98°",
        "kind": "siyu",
        "isMing": false,
        "deep": "吉庆、格调，化解凶险的那点好运余光。它落在掌管「形象与气质」的相貌宫，宫势属闲宫、力道偏淡。它是四余虚星，本身无吉凶，关键看你怎么用。"
      },
      {
        "key": "yuebei",
        "label": "月孛",
        "planet": "四余 · 虚星",
        "element": "水",
        "color": "#5a8ec0",
        "bg": "#5a8ec022",
        "essence": "潜意识、隐忧，藏在心底的暗流。",
        "houseName": "相貌",
        "mansion": "昴",
        "strength": "闲宫",
        "strengthLabel": "闲宫",
        "degree": "227.71°",
        "kind": "siyu",
        "isMing": false,
        "deep": "潜意识、隐忧，藏在心底的暗流。它落在掌管「形象与气质」的相貌宫，宫势属闲宫、力道偏淡。它是四余虚星，本身无吉凶，关键看你怎么用。"
      }
    ],
    "palaces": [
      {
        "index": 0,
        "name": "命宫",
        "range": "254.82° – 284.82°",
        "domain": "你是谁——性格底色与人生的总开关",
        "strength": "七强",
        "countLabel": "空宫",
        "isEmpty": true,
        "ruler": "宫主星 岁星 → 夫妻宫",
        "occupants": [],
        "deep": "命宫宫掌管性格底色与人生方向，是空宫——没有星曜直接进驻。这不代表人生空白，而要看它的宫主星落在哪、状态如何来间接判断。（宫主星 岁星 → 夫妻宫）"
      },
      {
        "index": 1,
        "name": "财帛",
        "range": "284.82° – 314.82°",
        "domain": "钱与资源——怎么挣、怎么守",
        "strength": "次强",
        "countLabel": "2 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "zhenxing",
            "label": "镇星",
            "planet": "土星",
            "element": "土",
            "color": "#c0902e",
            "bg": "#c0902e22",
            "essence": "责任、积累、根基与耐力的硬底。",
            "houseName": "财帛",
            "mansion": "鬼",
            "strength": "次强",
            "strengthLabel": "次强",
            "degree": "294.91°",
            "kind": "qizheng",
            "isMing": false,
            "deep": "责任、积累、根基与耐力的硬底。它落在掌管「钱财与资源」的财帛宫，宫势次强、稳定可用。"
          },
          {
            "key": "luohou",
            "label": "罗喉",
            "planet": "四余 · 虚星",
            "element": "火",
            "color": "#d06a59",
            "bg": "#d06a5922",
            "essence": "放大与执念，被无形牵引去做的事。",
            "houseName": "财帛",
            "mansion": "星",
            "strength": "次强",
            "strengthLabel": "次强",
            "degree": "313.11°",
            "kind": "siyu",
            "isMing": false,
            "deep": "放大与执念，被无形牵引去做的事。它落在掌管「钱财与资源」的财帛宫，宫势次强、稳定可用。它是四余虚星，本身无吉凶，关键看你怎么用。"
          }
        ],
        "deep": "财帛宫掌管钱财与资源。这里有 镇星、罗喉 2 曜入驻——本宫力量中上，星气不弱，值得多留意；把这份能量用在对的地方，就是你最该深耕的方向之一。"
      },
      {
        "index": 2,
        "name": "兄弟",
        "range": "314.82° – 344.82°",
        "domain": "手足、同辈与协作关系",
        "strength": "闲宫",
        "countLabel": "2 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "taibai",
            "label": "太白",
            "planet": "金星",
            "element": "金",
            "color": "#8f9b53",
            "bg": "#8f9b5322",
            "essence": "情感、审美、人缘与钱财的甜味。",
            "houseName": "兄弟",
            "mansion": "翼",
            "strength": "闲宫",
            "strengthLabel": "闲宫",
            "degree": "335.86°",
            "kind": "qizheng",
            "isMing": false,
            "deep": "情感、审美、人缘与钱财的甜味。它落在掌管「手足与同辈」的兄弟宫，宫势属闲宫、力道偏淡。"
          },
          {
            "key": "yinghuo",
            "label": "荧惑",
            "planet": "火星",
            "element": "火",
            "color": "#d06a59",
            "bg": "#d06a5922",
            "essence": "行动力、冲劲、脾气与争斗心。",
            "houseName": "兄弟",
            "mansion": "张",
            "strength": "闲宫",
            "strengthLabel": "闲宫",
            "degree": "323.34°",
            "kind": "qizheng",
            "isMing": false,
            "deep": "行动力、冲劲、脾气与争斗心。它落在掌管「手足与同辈」的兄弟宫，宫势属闲宫、力道偏淡。"
          }
        ],
        "deep": "兄弟宫掌管手足与同辈。这里有 太白、荧惑 2 曜入驻——本宫属闲宫、力道偏淡，星气不弱，值得多留意；把这份能量用在对的地方，就是你最该深耕的方向之一。"
      },
      {
        "index": 3,
        "name": "田宅",
        "range": "344.82° – 14.82°",
        "domain": "家与不动产——根基、住所、安全感",
        "strength": "七强",
        "countLabel": "空宫",
        "isEmpty": true,
        "ruler": "宫主星 岁星 → 夫妻宫",
        "occupants": [],
        "deep": "田宅宫掌管家、根基与不动产，是空宫——没有星曜直接进驻。这不代表人生空白，而要看它的宫主星落在哪、状态如何来间接判断。（宫主星 岁星 → 夫妻宫）"
      },
      {
        "index": 4,
        "name": "男女",
        "range": "14.82° – 44.82°",
        "domain": "子女、创作与付出传承",
        "strength": "次强",
        "countLabel": "2 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "taiyang",
            "label": "太阳",
            "planet": "日 · 太阳",
            "element": "火",
            "color": "#d06a59",
            "bg": "#d06a5922",
            "essence": "主体之光、外在身份与事业舞台，也代表父亲。",
            "houseName": "男女",
            "mansion": "亢",
            "strength": "次强",
            "strengthLabel": "次强",
            "degree": "21.85°",
            "kind": "qizheng",
            "isMing": false,
            "deep": "主体之光、外在身份与事业舞台，也代表父亲。它落在掌管「子女与创作」的男女宫，宫势次强、稳定可用。"
          },
          {
            "key": "chenxing",
            "label": "辰星",
            "planet": "水星",
            "element": "水",
            "color": "#5a8ec0",
            "bg": "#5a8ec022",
            "essence": "思维、表达、学习与沟通的那根线。",
            "houseName": "男女",
            "mansion": "房",
            "strength": "次强",
            "strengthLabel": "次强",
            "degree": "41.17°",
            "kind": "qizheng",
            "isMing": false,
            "deep": "思维、表达、学习与沟通的那根线。它落在掌管「子女与创作」的男女宫，宫势次强、稳定可用。"
          }
        ],
        "deep": "男女宫掌管子女与创作。这里有 太阳、辰星 2 曜入驻——本宫力量中上，星气不弱，值得多留意；把这份能量用在对的地方，就是你最该深耕的方向之一。"
      },
      {
        "index": 5,
        "name": "奴仆",
        "range": "44.82° – 74.82°",
        "domain": "下属、帮手与可调动的人脉",
        "strength": "闲宫",
        "countLabel": "空宫",
        "isEmpty": true,
        "ruler": "宫主星 太白 → 兄弟宫",
        "occupants": [],
        "deep": "奴仆宫掌管人手与人脉，是空宫——没有星曜直接进驻。这不代表人生空白，而要看它的宫主星落在哪、状态如何来间接判断。（宫主星 太白 → 兄弟宫）"
      },
      {
        "index": 6,
        "name": "夫妻",
        "range": "74.82° – 104.82°",
        "domain": "伴侣与亲密关系",
        "strength": "七强",
        "countLabel": "1 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "suixing",
            "label": "岁星",
            "planet": "木星",
            "element": "木",
            "color": "#5d9c69",
            "bg": "#5d9c6922",
            "essence": "扩展、机会、信念与贵人的来路。",
            "houseName": "夫妻",
            "mansion": "斗",
            "strength": "七强",
            "strengthLabel": "七强",
            "degree": "94.07°",
            "kind": "qizheng",
            "isMing": true,
            "deep": "扩展、机会、信念与贵人的来路。它落在掌管「伴侣与亲密关系」的夫妻宫，宫势七强、最为得位。作为你的命主星，它代表「你本人」那条主线，是看盘的第一落点。"
          }
        ],
        "deep": "夫妻宫掌管伴侣与亲密关系。这里有 岁星 1 曜入驻——本宫是全盘的强宫之一，主题清晰、不旁逸；把这份能量用在对的地方，就是你最该深耕的方向之一。命主也落在这里，更说明它是你的主场之一。"
      },
      {
        "index": 7,
        "name": "疾厄",
        "range": "104.82° – 134.82°",
        "domain": "身体、压力与要扛的劳累",
        "strength": "次强",
        "countLabel": "1 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "jidu",
            "label": "计都",
            "planet": "四余 · 虚星",
            "element": "土",
            "color": "#c0902e",
            "bg": "#c0902e22",
            "essence": "断舍与突变，旧的东西被悄悄收走。",
            "houseName": "疾厄",
            "mansion": "虚",
            "strength": "次强",
            "strengthLabel": "次强",
            "degree": "133.11°",
            "kind": "siyu",
            "isMing": false,
            "deep": "断舍与突变，旧的东西被悄悄收走。它落在掌管「身体与压力」的疾厄宫，宫势次强、稳定可用。它是四余虚星，本身无吉凶，关键看你怎么用。"
          }
        ],
        "deep": "疾厄宫掌管身体与压力。这里有 计都 1 曜入驻——本宫力量中上，主题清晰、不旁逸；把这份能量用在对的地方，就是你最该深耕的方向之一。"
      },
      {
        "index": 8,
        "name": "迁移",
        "range": "134.82° – 164.82°",
        "domain": "远行、变动与出门在外的际遇",
        "strength": "闲宫",
        "countLabel": "空宫",
        "isEmpty": true,
        "ruler": "宫主星 太阳 → 男女宫",
        "occupants": [],
        "deep": "迁移宫掌管远行与变动，是空宫——没有星曜直接进驻。这不代表人生空白，而要看它的宫主星落在哪、状态如何来间接判断。（宫主星 太阳 → 男女宫）"
      },
      {
        "index": 9,
        "name": "官禄",
        "range": "164.82° – 194.82°",
        "domain": "事业、职位与社会成就",
        "strength": "七强",
        "countLabel": "空宫",
        "isEmpty": true,
        "ruler": "宫主星 辰星 → 男女宫",
        "occupants": [],
        "deep": "官禄宫掌管事业与社会成就，是空宫——没有星曜直接进驻。这不代表人生空白，而要看它的宫主星落在哪、状态如何来间接判断。（宫主星 辰星 → 男女宫）"
      },
      {
        "index": 10,
        "name": "福德",
        "range": "194.82° – 224.82°",
        "domain": "内心、福气、精神世界与享受",
        "strength": "次强",
        "countLabel": "1 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "taiyin",
            "label": "太阴",
            "planet": "月 · 太阴",
            "element": "水",
            "color": "#5a8ec0",
            "bg": "#5a8ec022",
            "essence": "情绪与内心、母亲，以及身体的安定感。",
            "houseName": "福德",
            "mansion": "昴",
            "strength": "次强",
            "strengthLabel": "次强",
            "degree": "222.54°",
            "kind": "qizheng",
            "isMing": false,
            "deep": "情绪与内心、母亲，以及身体的安定感。它落在掌管「内心与精神世界」的福德宫，宫势次强、稳定可用。"
          }
        ],
        "deep": "福德宫掌管内心与精神世界。这里有 太阴 1 曜入驻——本宫力量中上，主题清晰、不旁逸；把这份能量用在对的地方，就是你最该深耕的方向之一。"
      },
      {
        "index": 11,
        "name": "相貌",
        "range": "224.82° – 254.82°",
        "domain": "外形、气质与给人的第一印象",
        "strength": "闲宫",
        "countLabel": "2 曜入宫",
        "isEmpty": false,
        "ruler": "",
        "occupants": [
          {
            "key": "ziqi",
            "label": "紫气",
            "planet": "四余 · 虚星",
            "element": "木",
            "color": "#5d9c69",
            "bg": "#5d9c6922",
            "essence": "吉庆、格调，化解凶险的那点好运余光。",
            "houseName": "相貌",
            "mansion": "毕",
            "strength": "闲宫",
            "strengthLabel": "闲宫",
            "degree": "234.98°",
            "kind": "siyu",
            "isMing": false,
            "deep": "吉庆、格调，化解凶险的那点好运余光。它落在掌管「形象与气质」的相貌宫，宫势属闲宫、力道偏淡。它是四余虚星，本身无吉凶，关键看你怎么用。"
          },
          {
            "key": "yuebei",
            "label": "月孛",
            "planet": "四余 · 虚星",
            "element": "水",
            "color": "#5a8ec0",
            "bg": "#5a8ec022",
            "essence": "潜意识、隐忧，藏在心底的暗流。",
            "houseName": "相貌",
            "mansion": "昴",
            "strength": "闲宫",
            "strengthLabel": "闲宫",
            "degree": "227.71°",
            "kind": "siyu",
            "isMing": false,
            "deep": "潜意识、隐忧，藏在心底的暗流。它落在掌管「形象与气质」的相貌宫，宫势属闲宫、力道偏淡。它是四余虚星，本身无吉凶，关键看你怎么用。"
          }
        ],
        "deep": "相貌宫掌管形象与气质。这里有 紫气、月孛 2 曜入驻——本宫属闲宫、力道偏淡，星气不弱，值得多留意；把这份能量用在对的地方，就是你最该深耕的方向之一。"
      }
    ],
    "patterns": [
      {
        "id": "core",
        "tag": "核心格局",
        "tone": "accent",
        "title": "财帛聚两曜 · 重心所在",
        "summary": "镇星 · 罗喉 同落财帛宫",
        "glyphs": [
          {
            "name": "镇星",
            "color": "#c0902e"
          },
          {
            "name": "罗喉",
            "color": "#d06a59"
          }
        ],
        "deep": "全盘十一曜，有 2 颗落在财帛宫。这一宫掌管钱财与资源，星气在这里特别集中——财帛的事就是你人生戏份最重的一块。优点是这块格外丰盈，是你最该深耕的主线；风险是同宫星多、容易在这件事上想太多、自我消耗。破局之道是把它往外用、变成看得见的结果。"
      },
      {
        "id": "peak",
        "tag": "最强一星",
        "tone": "gold",
        "title": "岁星守夫妻 · 七强",
        "summary": "木星以全盘最高之势坐夫妻",
        "glyphs": [
          {
            "name": "岁星",
            "color": "#5d9c69"
          }
        ],
        "deep": "岁星以七强之势坐夫妻宫，是全盘最得位的一颗星，含金量很高。它把你的力量压在伴侣与亲密关系上：这里是你最稳、最该深耕、也最容易出成果的地方。这类能量走的是「慢而确定」的路——守得住、耐得烦，时间会站在你这边。"
      },
      {
        "id": "watch",
        "tag": "要留心",
        "tone": "warn",
        "title": "疾厄一曜 · 身心是高频议题",
        "summary": "计都 同宫于疾厄",
        "glyphs": [
          {
            "name": "计都",
            "color": "#c0902e"
          }
        ],
        "deep": "疾厄宫坐着 计都，让身体与情绪成为你人生反复出现的主题。心里一有事，身体先反应，也容易被放大成内耗。核心功课只有一句：把休息、情绪和身体管理正经当回事，别等问题堆到身体抗议才回头。"
      }
    ],
    "gloss": {
      "七政": "日、月，加上金木水火土五颗行星，共七颗真实可见的星——古人叫它们「七政」，是星盘的主角。",
      "四余": "罗喉、计都、月孛、紫气，四个看不见的「虚星」（由月亮轨道的交点、远地点等推算出来），用来补充七政看不到的隐线索。",
      "命主": "代表「你本人」的那颗星，由命宫所在的位置决定。它的状态，往往是看盘的第一落点。",
      "身主": "代表「身体与现实生活」的星，和命主一内一外，合看更完整。",
      "空宫": "这个宫里没有星曜进驻。不代表这块人生空白，而是要去看它的「宫主星」落在哪、状态如何，来间接判断。",
      "宫势": "一颗星落在某个位置上有没有「力气」。七强最得位、能尽情发挥；次强中上、稳定可用；闲宫则不得位，作用偏淡甚至打折。",
      "宿": "二十八宿——把整条黄道分成 28 段的中国古老坐标系，比十二宫更精细，用来定位星曜到底在哪一格。",
      "黄道度": "星在黄道（太阳一年走过的轨道）上的精确位置，用 0°–360° 表示。",
      "上升度": "你出生那一刻，正从东方地平线升起的度数。它定下命宫的起点，是整张盘的地基。",
      "昼夜盘": "看你出生在白天还是夜里。夜盘里，月亮、金星等「夜的星」更得力。",
      "宫制": "把一圈黄道切成十二宫的方法。这里用「上升度起十二等宫」：从上升点开始，每 30° 一宫，均匀切分。"
    },
    "basisRows": [
      {
        "term": "上升度",
        "label": "上升度",
        "value": "254.82°"
      },
      {
        "term": "昼夜盘",
        "label": "昼夜盘",
        "value": "昼盘"
      },
      {
        "term": "宫制",
        "label": "宫制",
        "value": "上升度起十二等宫"
      },
      {
        "term": "宿",
        "label": "宿度",
        "value": "二十八宿等分模型 v1"
      },
      {
        "term": "四余",
        "label": "四余模型",
        "value": "罗喉/计都取月交点轴，紫气取 28 年虚点，月孛取月亮远地点"
      }
    ],
    "houses": [
      {
        "name": "命宫",
        "range": "254.82° – 284.82°",
        "occupants": ""
      },
      {
        "name": "财帛",
        "range": "284.82° – 314.82°",
        "occupants": "镇星 · 罗喉"
      },
      {
        "name": "兄弟",
        "range": "314.82° – 344.82°",
        "occupants": "太白 · 荧惑"
      },
      {
        "name": "田宅",
        "range": "344.82° – 14.82°",
        "occupants": ""
      },
      {
        "name": "男女",
        "range": "14.82° – 44.82°",
        "occupants": "太阳 · 辰星"
      },
      {
        "name": "奴仆",
        "range": "44.82° – 74.82°",
        "occupants": ""
      },
      {
        "name": "夫妻",
        "range": "74.82° – 104.82°",
        "occupants": "岁星"
      },
      {
        "name": "疾厄",
        "range": "104.82° – 134.82°",
        "occupants": "计都"
      },
      {
        "name": "迁移",
        "range": "134.82° – 164.82°",
        "occupants": ""
      },
      {
        "name": "官禄",
        "range": "164.82° – 194.82°",
        "occupants": ""
      },
      {
        "name": "福德",
        "range": "194.82° – 224.82°",
        "occupants": "太阴"
      },
      {
        "name": "相貌",
        "range": "224.82° – 254.82°",
        "occupants": "紫气 · 月孛"
      }
    ],
    "reading": {
      "summary": "命主岁星以七强之势坐夫妻宫，「以情为镜」：一段深的一对一关系是你照见自己的方式。镇星、罗喉同聚财帛，钱与资源是人生戏份最重的一块；太阳、辰星同坐男女宫，表达与创作有舞台。疾厄计都是长期提醒：把身心节律当成第一优先级。",
      "profile": {
        "life_pattern": "岁星守夫妻、财帛聚双曜，你的人生主线是「关系」与「资源」两条：在稳定的亲密关系里成长，在钱与资源的经营上花最多心思。",
        "strengths": "木星七强带来扩展力与贵人缘，太阴福德次强让你内心有余裕；太阳、辰星在男女宫，把想法讲清楚、做成作品是天赋。",
        "long_term_theme": "罗喉在财帛放大对安全感的执念，容易为钱过度焦虑；计都在疾厄提示旧模式会在身体上先发出信号，学会及早收手。",
        "relationship_pattern": "命主在夫妻宫，伴侣对你的影响远超常人：选对人、并在关系里保持自我边界，是最重要的一件事。太白闲宫，人缘要靠真诚而非社交技巧。",
        "career_inclination": "官禄空宫，宫主辰星落男女：事业不靠头衔而靠作品与表达。适合内容、教育、设计与顾问类工作，2022 年的创业选择与此吻合。"
      },
      "starGuidance": [
        {
          "bodyKey": "suixing",
          "bodyLabel": "岁星",
          "houseName": "夫妻",
          "mansion": "斗",
          "theme": "深耕一段关系",
          "strategy": "木星是你最得力的星，落在夫妻宫：把时间投给一段值得的长期关系，你的机会与贵人多半从这里延伸出来。"
        },
        {
          "bodyKey": "zhenxing",
          "bodyLabel": "镇星",
          "houseName": "财帛",
          "mansion": "鬼",
          "theme": "慢钱比快钱稳",
          "strategy": "土星守财帛，靠积累而非投机：给工作室建立现金流纪律，罗喉同宫时尤其要避免为安全感做冲动决定。"
        },
        {
          "bodyKey": "taiyang",
          "bodyLabel": "太阳",
          "houseName": "男女",
          "mansion": "亢",
          "theme": "用作品被看见",
          "strategy": "太阳与辰星同坐男女宫：持续产出作品、课程或文章，事业舞台会从创作里长出来，而不是从头衔里。"
        },
        {
          "bodyKey": "jidu",
          "bodyLabel": "计都",
          "houseName": "疾厄",
          "mansion": "虚",
          "theme": "身体先于计划",
          "strategy": "计都在疾厄，压力会先写在身体上。把睡眠、运动和体检当成固定日程，而不是忙完再说。"
        }
      ]
    }
  }
};
