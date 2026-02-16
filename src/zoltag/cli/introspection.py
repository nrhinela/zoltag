"""CLI command introspection and queue argument helpers."""

from __future__ import annotations

import sys
from functools import lru_cache
from typing import Any

import click


_TRUE_VALUES = {"1", "true", "yes", "y", "on"}
_FALSE_VALUES = {"0", "false", "no", "n", "off"}


def _normalize_default(value: Any) -> Any:
    """Convert click defaults to JSON-safe values."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_normalize_default(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _normalize_default(item) for key, item in value.items()}
    return str(value)


def _is_tenant_option(param: click.Parameter) -> bool:
    return isinstance(param, click.Option) and str(param.name or "") == "tenant_id"


def _is_queue_override_param(param: click.Parameter) -> bool:
    if not getattr(param, "expose_value", True):
        return False
    if isinstance(param, click.Option) and getattr(param, "is_eager", False):
        return False
    if _is_tenant_option(param):
        return False
    return True


def _param_input_type(param: click.Parameter) -> str:
    if isinstance(param, click.Option) and param.is_flag:
        return "boolean"
    param_type = getattr(param, "type", None)
    if isinstance(param_type, click.Choice):
        return "choice"
    if isinstance(param_type, click.IntRange):
        return "integer"
    if isinstance(param_type, click.FloatRange):
        return "number"
    if isinstance(param_type, click.types.IntParamType):
        return "integer"
    if isinstance(param_type, click.types.FloatParamType):
        return "number"
    if isinstance(param_type, click.types.BoolParamType):
        return "boolean"
    if isinstance(param_type, click.DateTime):
        return "datetime"
    if isinstance(param_type, click.Path):
        return "path"
    return "string"


def _primary_option(param: click.Option) -> str:
    if param.opts:
        return str(param.opts[0])
    return f"--{str(param.name or '').replace('_', '-')}"


def _secondary_option(param: click.Option) -> str | None:
    secondary = getattr(param, "secondary_opts", None) or []
    if secondary:
        return str(secondary[0])
    return None


def _serialize_param(param: click.Parameter) -> dict[str, Any]:
    param_type = _param_input_type(param)
    serialized = {
        "name": str(param.name or ""),
        "param_type": "option" if isinstance(param, click.Option) else "argument",
        "opts": list(getattr(param, "opts", []) or []),
        "secondary_opts": list(getattr(param, "secondary_opts", []) or []),
        "help": str(getattr(param, "help", "") or ""),
        "default": _normalize_default(getattr(param, "default", None)),
        "required": bool(getattr(param, "required", False)),
        "nargs": getattr(param, "nargs", None),
        "multiple": bool(getattr(param, "multiple", False)),
        "is_flag": bool(getattr(param, "is_flag", False)),
        "input_type": param_type,
    }

    param_type_obj = getattr(param, "type", None)
    if isinstance(param_type_obj, click.Choice):
        serialized["choices"] = list(param_type_obj.choices or [])
    if isinstance(param_type_obj, click.IntRange):
        if param_type_obj.min is not None:
            serialized["minimum"] = int(param_type_obj.min)
        if param_type_obj.max is not None:
            serialized["maximum"] = int(param_type_obj.max)
    if isinstance(param_type_obj, click.FloatRange):
        if param_type_obj.min is not None:
            serialized["minimum"] = float(param_type_obj.min)
        if param_type_obj.max is not None:
            serialized["maximum"] = float(param_type_obj.max)

    return serialized


@lru_cache(maxsize=1)
def _command_index() -> dict[str, click.Command]:
    from zoltag.cli import cli as cli_group

    return dict(getattr(cli_group, "commands", {}) or {})


def get_cli_command(name: str) -> click.Command | None:
    return _command_index().get(str(name or "").strip())


def is_queue_eligible_command(command: click.Command) -> bool:
    return any(_is_tenant_option(param) for param in command.params)


def get_cli_command_metadata(name: str) -> dict[str, Any] | None:
    command_name = str(name or "").strip()
    command = get_cli_command(command_name)
    if command is None:
        return None
    ctx = click.Context(command, info_name=f"zoltag {command_name}")
    params = [_serialize_param(param) for param in command.params]
    queue_params = [_serialize_param(param) for param in command.params if _is_queue_override_param(param)]
    return {
        "name": command_name,
        "help": str(command.help or ""),
        "usage": command.get_usage(ctx).replace("Usage:", "").strip(),
        "params": params,
        "queue_eligible": is_queue_eligible_command(command),
        "queue_params": queue_params,
    }


def list_cli_commands_metadata() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name in sorted(_command_index().keys()):
        metadata = get_cli_command_metadata(name)
        if metadata:
            rows.append(metadata)
    return rows


def build_payload_schema_for_command(name: str) -> dict[str, Any] | None:
    command_meta = get_cli_command_metadata(name)
    if not command_meta or not command_meta.get("queue_eligible"):
        return None

    properties: dict[str, dict[str, Any]] = {}
    required: list[str] = []

    for param in command_meta.get("queue_params", []):
        param_name = str(param.get("name") or "").strip()
        if not param_name:
            continue
        prop: dict[str, Any] = {}
        input_type = str(param.get("input_type") or "string")
        if input_type == "integer":
            prop["type"] = "integer"
        elif input_type == "number":
            prop["type"] = "number"
        elif input_type == "boolean":
            prop["type"] = "boolean"
        else:
            prop["type"] = "string"

        help_text = str(param.get("help") or "").strip()
        if help_text:
            prop["description"] = help_text

        if "choices" in param and isinstance(param["choices"], list) and param["choices"]:
            prop["enum"] = list(param["choices"])

        if "minimum" in param:
            prop["minimum"] = param["minimum"]
        if "maximum" in param:
            prop["maximum"] = param["maximum"]

        if "default" in param and param["default"] not in (None, ""):
            prop["default"] = param["default"]

        properties[param_name] = prop
        if bool(param.get("required")):
            required.append(param_name)

    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "additionalProperties": False,
    }
    if required:
        schema["required"] = required
    return schema


def _coerce_bool(raw_value: Any, *, field_name: str) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    text = str(raw_value or "").strip().lower()
    if text in _TRUE_VALUES:
        return True
    if text in _FALSE_VALUES:
        return False
    raise ValueError(f"{field_name} must be a boolean")


def _convert_param_value(command: click.Command, param: click.Parameter, raw_value: Any) -> Any:
    if isinstance(param, click.Option) and param.is_flag:
        return _coerce_bool(raw_value, field_name=str(param.name or "value"))

    if raw_value is None:
        return None

    ctx = click.Context(command, info_name=f"zoltag {command.name or ''}")
    param_name = str(param.name or "value")

    try:
        if getattr(param, "multiple", False):
            values = raw_value if isinstance(raw_value, (list, tuple)) else [raw_value]
            return [param.type.convert(value, param, ctx) for value in values]

        nargs = int(getattr(param, "nargs", 1) or 1)
        if nargs != 1:
            if not isinstance(raw_value, (list, tuple)):
                raise ValueError(f"{param_name} must be a list with {nargs} items")
            if len(raw_value) != nargs:
                raise ValueError(f"{param_name} must have exactly {nargs} items")
            return [param.type.convert(value, param, ctx) for value in raw_value]

        return param.type.convert(raw_value, param, ctx)
    except Exception as exc:
        raise ValueError(f"Invalid value for {param_name}: {exc}") from exc


def normalize_queue_payload(command_name: str, payload: dict[str, Any] | None) -> dict[str, Any]:
    command_key = str(command_name or "").strip()
    command = get_cli_command(command_key)
    if command is None:
        raise ValueError(f"Unknown CLI command: {command_key}")
    if not is_queue_eligible_command(command):
        raise ValueError(f"CLI command is not queue-eligible (missing --tenant-id): {command_key}")

    payload_obj = payload or {}
    if not isinstance(payload_obj, dict):
        raise ValueError("payload must be an object")

    params_by_name = {
        str(param.name): param
        for param in command.params
        if _is_queue_override_param(param) and str(param.name or "").strip()
    }

    unknown_keys = sorted(key for key in payload_obj.keys() if key not in params_by_name)
    if unknown_keys:
        unknown_text = ", ".join(str(key) for key in unknown_keys)
        raise ValueError(f"Unsupported arguments for {command_key}: {unknown_text}")

    normalized: dict[str, Any] = {}
    for name, param in params_by_name.items():
        if name not in payload_obj:
            continue
        raw_value = payload_obj.get(name)
        if raw_value in (None, "") and not (isinstance(param, click.Option) and param.is_flag):
            continue
        normalized[name] = _convert_param_value(command, param, raw_value)

    for name, param in params_by_name.items():
        if bool(getattr(param, "required", False)) and name not in normalized:
            raise ValueError(f"Missing required argument: {name}")

    return normalized


def build_queue_command_argv(
    *,
    command_name: str,
    tenant_id: str,
    payload: dict[str, Any] | None,
    python_executable: str | None = None,
) -> list[str]:
    command_key = str(command_name or "").strip()
    command = get_cli_command(command_key)
    if command is None:
        raise ValueError(f"Unknown CLI command: {command_key}")
    if not is_queue_eligible_command(command):
        raise ValueError(f"CLI command is not queue-eligible (missing --tenant-id): {command_key}")

    normalized_payload = normalize_queue_payload(command_key, payload)
    argv = [str(python_executable or sys.executable), "-m", "zoltag.cli", command_key]

    tenant_option = next((param for param in command.params if _is_tenant_option(param)), None)
    if isinstance(tenant_option, click.Option):
        argv.extend([_primary_option(tenant_option), str(tenant_id)])
    else:
        raise ValueError(f"CLI command is not queue-eligible (missing --tenant-id): {command_key}")

    for param in command.params:
        param_name = str(param.name or "").strip()
        if not param_name or param_name not in normalized_payload:
            continue
        if not _is_queue_override_param(param):
            continue

        value = normalized_payload[param_name]

        if isinstance(param, click.Option):
            if param.is_flag:
                bool_value = bool(value)
                default_bool = bool(getattr(param, "default", False))
                if bool_value == default_bool:
                    continue
                if bool_value:
                    argv.append(_primary_option(param))
                else:
                    secondary = _secondary_option(param)
                    if not secondary:
                        raise ValueError(f"Cannot set {param_name}=false for this command")
                    argv.append(secondary)
                continue

            option_name = _primary_option(param)
            if isinstance(value, list):
                for item in value:
                    argv.extend([option_name, str(item)])
            else:
                argv.extend([option_name, str(value)])
            continue

        if isinstance(value, list):
            argv.extend(str(item) for item in value)
        else:
            argv.append(str(value))

    return argv
