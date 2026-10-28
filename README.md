# claude-plugins

Claude Code plugins for the JezzWTF workflow, shipped as one local marketplace.

| Plugin | What it does |
| --- | --- |
| `keep-warm` | Pings the session before the 1-hour prompt cache expires. Toggle with `/keep-warm`. |

## Install

```bash
claude plugin marketplace add E:/JezzWTF/claude-plugins
claude plugin install keep-warm@local
```

After editing a plugin, run `/reload-plugins`.
