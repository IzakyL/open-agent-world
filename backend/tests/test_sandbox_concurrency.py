"""Overlapping commands, ownership and cleanup across the shared environment."""
import asyncio
import os
import threading
import time

import pytest

from backend.capabilities.provider import WorldAgentCapabilityProvider
from backend.errors import PermissionDeniedError
from backend.sandbox.history import read, stop
from backend.sandbox.models import SandboxStateError
from backend.sandbox.win32 import NativeCommandResult
from backend.tests.conftest import create_node
from backend.tests.test_skill_runtime import runtime_client, setup_skill


@pytest.mark.parametrize("finish", ["cancel", "caller_cancel", "timeout", "stop"])
def test_agents_overlap_with_independent_output_and_cleanup(runtime_client, monkeypatch, finish):
    client, backend, native = runtime_client
    agent_a, sandbox, _, _, _ = setup_skill(client)
    agent_b = create_node(client, "agent")
    assert client.post('/api/edges', json={"source": agent_b['id'], "target": sandbox['id'], "relationship": "execute"}).status_code == 201
    services = client.app.state.services
    backend._event_sink = services.publish_sandbox_event
    entered = {name: threading.Event() for name in ('a', 'b')}
    release = threading.Event()

    def workload(profile, argv, **options):
        name = argv[-1]
        options['on_job_open'](101 if name == 'a' else 102)
        started = time.monotonic()
        try:
            (options['cwd'] / f'{name}.txt').write_text(name)
            options['on_stdout'](f'{name}-only\n')
            entered[name].set()
            while not release.wait(.01) and not options['cancel_event'].is_set():
                if name == 'b' and finish == 'timeout' and time.monotonic() - started > .5:
                    return NativeCommandResult(-9, 'b-only\n', '', .5, True, False)
            return NativeCommandResult(0, f'{name}-only\n', '', time.monotonic() - started,
                False, options['cancel_event'].is_set())
        finally:
            options['on_job_close']()

    monkeypatch.setattr(native, 'run_appcontainer', workload)

    async def scenario():
        provider = WorldAgentCapabilityProvider(services)
        first = asyncio.create_task(services.execute_sandbox(sandbox['id'], ['cmd.exe', 'a'], agent_id=agent_a['id']))
        second = None
        try:
            assert await asyncio.to_thread(entered['a'].wait, 3)
            second = asyncio.create_task(services.execute_sandbox(sandbox['id'], ['cmd.exe', 'b'], agent_id=agent_b['id']))
            assert await asyncio.to_thread(entered['b'].wait, 3), 'B must start before A finishes'
            info = await provider.invoke_tool(agent_b['id'], 'operation:inspect_sandbox', {'sandbox': sandbox['id']})
            assert len(info['active_commands']) == 2
            assert info['current_command_id'] is None
            receipts = {r['caller']: r for r in read(services, sandbox['id']) if r['state'] == 'running'}
            a, b = receipts[agent_a['id']], receipts[agent_b['id']]
            assert a['stdout'] == 'a-only\n' and b['stdout'] == 'b-only\n'
            with pytest.raises(SandboxStateError, match='command_id'):
                await stop(services, sandbox['id'])
            with pytest.raises(PermissionDeniedError):
                await stop(services, sandbox['id'], agent_id=agent_b['id'], command_id=a['id'])
            if finish == 'cancel':
                await stop(services, sandbox['id'], agent_id=agent_b['id'], command_id=b['id'])
                assert (await second).cancelled
            elif finish == 'caller_cancel':
                second.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await second
            elif finish == 'timeout':
                assert (await asyncio.wait_for(second, 3)).timed_out
            else:
                await stop(services, sandbox['id'], terminate=True)
                await asyncio.gather(first, second, return_exceptions=True)
                assert (await backend.get(sandbox['id'])).state.value == 'stopped'
                assert not services._sandbox_tasks
                return
            assert not first.done()
            assert (await backend.get(sandbox['id'])).state.value == 'running'
            assert 101 not in native.terminated_jobs
            release.set()
            result = await first
            assert result.stdout == 'a-only\n' and result.command_id == a['id']
            assert (await backend.get(sandbox['id'])).state.value == 'ready'
            with pytest.raises(SandboxStateError, match='no longer active'):
                await stop(services, sandbox['id'], command_id=b['id'])
            assert not services._sandbox_tasks
        finally:
            release.set()
            await asyncio.gather(*(task for task in (first, second) if task), return_exceptions=True)

    client.portal.call(scenario)


def test_cancel_cleanup_failure_is_durable_and_closes_admission(runtime_client, monkeypatch):
    from backend.sandbox.models import SandboxSecurityError
    client, backend, _ = runtime_client
    _, sandbox, _, _, _ = setup_skill(client)
    services = client.app.state.services
    async def scenario():
        entered = asyncio.Event()
        async def failing_cleanup(*args, **kwargs):
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                raise SandboxSecurityError('process cleanup unconfirmed')
        monkeypatch.setattr(backend, 'execute', failing_cleanup)
        task = asyncio.create_task(services.execute_sandbox(sandbox['id'], ['long-command']))
        await asyncio.wait_for(entered.wait(), 3)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        receipt = read(services, sandbox['id'])[-1]
        assert receipt['cleanup'] == 'failed' and not receipt['termination_confirmed']
        assert receipt['cancellation_reason'] == 'caller_cancelled'
        with pytest.raises(SandboxStateError, match='admission is closed'):
            await services.execute_sandbox(sandbox['id'], ['must-not-start'])
        await stop(services, sandbox['id'], terminate=True)
        assert sandbox['id'] not in services._sandbox_stopping
        assert read(services, sandbox['id'])[-1]['cleanup'] == 'complete'
    client.portal.call(scenario)


def test_linux_bundle_revisions_keep_previous_files(tmp_path):
    from backend.sandbox.materialization import RuntimeBundle, materialize_bundle
    before = RuntimeBundle('skills/demo', (('run.py', b'old revision'),)).versioned()
    after = RuntimeBundle('skills/demo', (('run.py', b'new revision'),)).versioned()
    old_root = materialize_bundle(tmp_path, before)
    new_root = materialize_bundle(tmp_path, after)
    assert old_root != new_root
    assert (old_root / 'run.py').read_bytes() == b'old revision'
    assert (new_root / 'run.py').read_bytes() == b'new revision'


def test_windows_shared_policy_conflicts_are_retryable(runtime_client, monkeypatch):
    client, backend, native = runtime_client
    agent, sandbox, skill, _, _ = setup_skill(client)
    services = client.app.state.services
    entered, release = threading.Event(), threading.Event()
    original = native.run_appcontainer
    def workload(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)
    monkeypatch.setattr(native, 'run_appcontainer', workload)
    async def scenario():
        task = asyncio.create_task(services.execute_sandbox(sandbox['id'], ['cmd.exe']))
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            provider = WorldAgentCapabilityProvider(services)
            result = await provider.invoke_tool(agent['id'], f"sandbox.run_skill_script:{sandbox['id']}",
                {'skill_id': skill['id'], 'script_path': 'scripts/check.py', 'interpreter': ['python']})
            assert result['error']['code'] == 'resource_busy'
            assert result['error']['retryable'] is True
            assert 'retry after active commands' in result['error']['message']
            assert not task.done()
        finally:
            release.set()
            await task
    client.portal.call(scenario)


@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get('OAW_TEST_WSL_DISTRO'), reason='requires an existing WSL2 distro')
async def test_real_wsl_overlap_and_cancel_one_process_tree(tmp_path):
    from backend.sandbox.wsl import WslSandboxBackend
    from backend.sandbox.models import SandboxEventType, ResourceAccess
    started = asyncio.Event()
    async def sink(event):
        if event.type == SandboxEventType.STDOUT and 'a-started' in event.payload.get('text', ''):
            started.set()
    backend = WslSandboxBackend(tmp_path / 'managed', distribution=os.environ['OAW_TEST_WSL_DISTRO'], event_sink=sink)
    project = tmp_path / 'project'
    project.mkdir()
    await backend.create('shared')
    await backend.configure('shared', workspace_path=str(project), workspace_access=ResourceAccess.READ_WRITE)
    await backend.start('shared')
    await backend.prepare_python()
    first = asyncio.create_task(backend.execute('shared', ['/bin/sh', '-c', 'echo a-started; sleep 30; echo done > a.txt'], timeout_seconds=45))
    try:
        marker = asyncio.create_task(started.wait())
        done, _ = await asyncio.wait({marker, first}, timeout=40, return_when=asyncio.FIRST_COMPLETED)
        if first in done:
            result = await first
            pytest.fail(f'First command exited before its marker: {result}')
        if marker not in done:
            marker.cancel()
            await asyncio.gather(marker, return_exceptions=True)
            pytest.fail('First command did not emit its start marker')
        assert (await backend.start('shared')).state.value == 'running'
        assert not first.done()
        second = await backend.execute('shared', ['/bin/sh', '-c', 'echo done > b.txt; echo b-finished'], timeout_seconds=10)
        assert second.exit_code == 0 and 'b-finished' in second.stdout
        assert not first.done() and (project / 'b.txt').exists()
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert not (project / 'a.txt').exists()
        assert (await backend.execute('shared', ['/bin/echo', 'still-ready'])).exit_code == 0
    finally:
        if not first.done():
            first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        await backend.destroy('shared')


@pytest.mark.asyncio
@pytest.mark.skipif(os.name != 'nt' or not os.environ.get('OPEN_AGENT_WORLD_RUN_NATIVE_SANDBOX_TESTS'), reason='requires native Windows acceptance opt-in')
async def test_real_windows_overlap_and_cancel_one_job(tmp_path):
    from backend.sandbox.windows import WindowsSandboxBackend
    from backend.sandbox.models import SandboxEventType
    started = asyncio.Event()
    async def sink(event):
        if event.type == SandboxEventType.STDOUT and 'a-started' in event.payload.get('text', ''):
            started.set()
    backend = WindowsSandboxBackend(tmp_path / 'managed', event_sink=sink)
    info = await backend.create('shared')
    (info.workspace / 'wait.cmd').write_text('@echo a-started\n:wait\n@if not exist release.txt goto wait\n@echo done > a.txt\n')
    await backend.start('shared')
    shell = str(__import__('pathlib').Path(os.environ['SystemRoot']) / 'System32' / 'cmd.exe')
    first = asyncio.create_task(backend.execute('shared', [shell, '/d', '/c', 'wait.cmd'], timeout_seconds=20))
    try:
        await asyncio.wait_for(started.wait(), 10)
        assert (await backend.start('shared')).state.value == 'running'
        assert not first.done()
        second = await backend.execute('shared', [shell, '/d', '/c', 'echo done > b.txt'], timeout_seconds=5)
        assert second.exit_code == 0, second.stderr
        assert not first.done() and (info.workspace / 'b.txt').exists()
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        assert not (info.workspace / 'a.txt').exists()
        assert (await backend.execute('shared', [shell, '/d', '/c', 'echo still-ready'])).exit_code == 0
    finally:
        if not first.done():
            first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        await backend.destroy('shared')
