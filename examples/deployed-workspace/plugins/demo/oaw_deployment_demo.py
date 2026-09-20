"""Local scripted demo provider. No model, network request, or tool execution."""
from backend.agents.mock import MockAgentRuntime
from backend.agents.models import AgentEvent, AgentEventType
from backend.plugins.registry import PluginDescriptor
from backend.runs.models import RunStatus


class DemoRuntime(MockAgentRuntime):
    async def execute(self, config, context, runtime_input):
        # Deliberately do not echo the composed prompt: it contains internal context.
        text = (
            "你好！你的消息已经通过锁定应用到达了后台助手。\n\n"
            "这是无需 API Key 的本地演示，我会返回这段预设回复。\n\n"
            "你可以继续体验：\n"
            "1. 新建对话，发送消息，再刷新页面查看保留的记录。\n"
            "2. 在右侧切换「使用指南」和「交付清单」。\n"
            "3. 退出登录，重新输入体验密码进入。\n\n"
            "正式应用可在工程端接入真实模型后重新发布，用户仍然使用这样的简洁页面。"
        )
        yield AgentEvent(context.agent_id, context.run_id, AgentEventType.MESSAGE,
                         {"text": text, "final": True})
        yield AgentEvent(context.agent_id, context.run_id, AgentEventType.COMPLETED,
                         {"text": text}, run_status=RunStatus.SUCCEEDED)


class DemoPlugin:
    descriptor = PluginDescriptor(id="example.deployment-demo", version="0.1.0",
                                  plugin_api_version="1.20", name="Deployment demo")

    def register(self, registration):
        registration.register_runtime_provider(
            "example.deployment-demo", lambda capability_provider, **options: DemoRuntime(capability_provider))


def create_plugin():
    return DemoPlugin()
