# 个人资料与主页

个人主页把你的对外资料与社交内容放在一起：修改显示名、头像和简介，浏览帖子、收藏与点赞，或回到自己关注的世界。

## 资料与内容

| 区域 | 展示内容 |
| --- | --- |
| **个人资料** | 显示名、头像、简介及其他可编辑的账号资料 |
| **帖子** | 当前账号按可见性规则能够读取的帖子 |
| **收藏与点赞** | 对应的社交内容，仍受各自可见性规则约束 |
| **关注的世界** | 仅在自己的主页提供，列出当前设备上该账号关注的世界 |

账号 ID 标识的是用户本人。角色源资料与 Runtime LocalAgent 使用各自的界面；个人主页不是私有 Agent 对话或记忆的目录。

## 修改资料

1. 从账号导航进入自己的主页。
2. 点击**编辑资料**，修改字段或上传头像。
3. 点击**保存**并确认结果；Desktop 通过 SDK 将修改提交到 Realm。
4. 其他界面在刷新资料后显示已保存的内容。

查看他人主页时，可见信息与可用社交操作取决于双方关系和 Realm 的访问规则。编辑控件仅用于自己的资料。

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
