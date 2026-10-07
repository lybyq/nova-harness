# Role 编写

RoleProfile 包含 metadata、extends、runtime、required/recommended/optional/denied、permissions 和 defaults。继承按父到子合并；deny 永远优先；`enforced` 权限只能变得更严格。

```bash
nova role clone frontend frontend-architect
nova role edit frontend-architect --file role.yaml
nova role validate frontend-architect
nova role publish frontend-architect
nova role use frontend-architect
```

发布前 Hub 会联合检查继承环、缺失能力、SemVer、依赖环和 conflicts，并返回安装顺序与警告。角色 required 能力不能通过 `nova remove` 绕过，必须修改角色或切换角色。
