# NimiGo

NimiGo 是由你任命的现有 Nimi Agent 协助推进项目、资料和成果的工作空间。岗位资料留在工作空间，Agent 的人格和长期记忆由 Nimi 管理。

1. 在左下角选择工作搭档，建立项目与具体交付目标。
2. 添加文本或 Markdown 资料，选择或编辑工作方法，交给搭档执行。
3. 查看步骤、补充回答，必要时停止。只有实际保存的成果或完成的源业务修改才计为交付；口头回复保持“待交付”。
4. 从成果库打开文档，编辑并保存新版本；原版本保留。也可在文件夹中显示，或交给搭档继续改进。
5. 把成功工作提炼为方法，用于另一项工作或每日例行。例行需要 App 与 Nimi 保持运行，关闭期间不会自动补跑；可以暂停或手动运行。

项目背景随每次委托提供给搭档；工作可编辑名称、目标、项目与方法，资料可修订并保留出处。修改工作输入会回到待开始，实际成果与执行记录保留。队列按加入顺序执行，进行中的工作不会占住创建其他工作的表单。项目成果按当前项目检索，近期目录有界，完整查询通过 `find_deliverables` 分页；跨工作复用另存成果。

生态来源显示出处与时间，通过公共 Activity 打开源对象；World Studio 资料可读入评审，源摘要修改须审核前后内容并由 Realm 校验权限和版本。打开来源不等于完成源事项。

Avatar 交接使用当前同一 Agent。语音使用已有 Conversation/Realtime 配置；需要 Agent 的有效声音/路线和麦克风条件。

项目、方法、工作记录与文档版本使用 Nimi 的应用私有存储。不同注册与账户分别保存；失效会话不自动转用另一位 Agent。应用重开会核对未决轮次，不重放已执行的业务操作。

## 本地运行与构建

本项目属于 Nimi 主仓 pnpm workspace，与 Zhiyu 等同仓 App 一样，由根 lockfile 管理依赖，SDK、Kit、App Tools 使用 `workspace:*`。安装与构建入口见 [README](README.md)。

日常开发从 Nimi 主仓根目录使用：

```sh
pnpm dev:nimigo -- --list-registrations
pnpm dev:nimigo -- --resume <刚枚举出的原注册 selector>
```

根启动器使用当前 workspace 的 App Tools，由 Desktop 监督 Electron，支持正常热更新。首次建立开发注册可直接 `pnpm dev:nimigo`；继续已有工作时必须 resume 原注册，不能新建主体代替原数据。运行依赖已启动的 Nimi Runtime 与 Home。

**开发迭代不反复打包安装。** 当前源码与此前安装包的版本、验收结果分开记录。根 workspace 构建不等于已生成或验证新的安装包；需要安装包时另走主仓支持的交付路径，不恢复独立 scaffold 和包模式 overrides。当前验收范围与限制见 `.nimi/local/delivery.md`。
