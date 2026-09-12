"""Pinned, text-only Codex configuration shared by the adapter and offline probe.

Verified against openai/codex rust-v0.153.4 config_toml.rs, ModelInfo and
core/src/tools/spec_plan.rs. A catalog is explicit: fallback metadata is refused.
"""
import json

VERSION = 'codex-cli 0.153.4'
MODEL = 'gpt-5.6-luna'
MODEL_KEY = 'codex-0.153.4:gpt-5.6-luna:knowledge-v1'


def catalog(model=MODEL):
    return {'models': [{'slug': model, 'display_name': model, 'description': None,
        'base_instructions': 'Summarize only the supplied document data. Return the requested JSON. No tools.',
        'default_reasoning_level': 'medium',
        'supported_reasoning_levels': [{'effort': 'medium', 'description': 'Bounded synthesis'}],
        'shell_type': 'disabled', 'visibility': 'list', 'supported_in_api': True,
        'priority': 0, 'availability_nux': None, 'upgrade': None,
        'support_verbosity': True, 'default_verbosity': 'low',
        'apply_patch_tool_type': None, 'experimental_supported_tools': [],
        'include_skills_usage_instructions': False, 'include_apps_usage_instructions': False,
        'include_plugin_usage_instructions': False, 'supports_search_tool': False,
        'node_repl_disabled': True, 'input_modalities': ['text'],
        'context_window': 272000, 'truncation_policy': {'mode': 'tokens', 'limit': 10000}}]}


def config(catalog_path):
    values = {'model': MODEL, 'model_catalog_json': str(catalog_path),
        'model_provider': 'knowledge_codex', 'web_search': 'disabled', 'project_doc_max_bytes': 0,
        'tools.experimental_request_user_input.enabled': False, 'tools.update_plan.enabled': False,
        'history.persistence': 'none', 'cli_auth_credentials_store': 'ephemeral',
        'analytics.enabled': False, 'feedback.enabled': False,
        'skills.bundled.enabled': False, 'skills.include_instructions': False,
        'orchestrator.skills.enabled': False, 'orchestrator.mcp.enabled': False,
        'model_reasoning_effort': 'medium', 'model_reasoning_summary': 'none',
        'model_providers.knowledge_codex.name': 'Codex knowledge',
        'model_providers.knowledge_codex.base_url': 'https://chatgpt.com/backend-api/codex',
        'model_providers.knowledge_codex.wire_api': 'responses',
        'model_providers.knowledge_codex.requires_openai_auth': True,
        'model_providers.knowledge_codex.request_max_retries': 0,
        'model_providers.knowledge_codex.stream_max_retries': 0,
        'model_providers.knowledge_codex.supports_websockets': False}
    for feature in ('shell_tool', 'unified_exec', 'view_image', 'multi_agent', 'apps',
                    'plugins', 'memories', 'hooks', 'image_generation', 'tool_suggest',
                    'request_permissions_tool', 'token_budget', 'current_time_reminder',
                    'sleep_tool', 'deferred_executor'):
        values['features.' + feature] = False
    return values


def arguments(catalog_path):
    args = ['--strict-config']
    for key, value in config(catalog_path).items():
        args += ['-c', key + '=' + json.dumps(value)]
    return args
