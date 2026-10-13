from __future__ import annotations

import csv
import datetime as dt
import io

from django.http import HttpResponse
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import audit
from apps.core import cache as core_cache
from apps.core.exceptions import DomainError, ErrorCode
from apps.core.permissions import HasCapability, IsStaffUser, branch_ids_for, user_has_capability

from . import queries

CACHE_TTL = 120
_FORMULA_CHARS = ("=", "+", "-", "@", "\t", "\r")


def parse_date(value: str | None, name: str) -> dt.date | None:
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise DomainError(
            ErrorCode.VALIDATION_ERROR, f"{name} must be a date like 2026-10-31.", details={name: ["Invalid date."]}
        ) from None


def resolve_scope(request) -> list[int] | None:
    """Branches the report may cover: the staff member's scope, optionally narrowed to one branch they can access."""
    allowed = branch_ids_for(request.user)
    raw = request.query_params.get("branch")
    if raw:
        if not raw.isdigit():
            raise DomainError(ErrorCode.VALIDATION_ERROR, "branch must be a branch id.")
        branch_id = int(raw)
        if allowed is not None and branch_id not in allowed:
            raise DomainError(ErrorCode.FORBIDDEN, "You don't have access to that branch.", status_code=403)
        return [branch_id]
    return allowed


def csv_safe(value) -> str:
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(_FORMULA_CHARS) else text  # neutralise spreadsheet formula injection


class DashboardView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = "reports.read"

    @extend_schema(
        parameters=[OpenApiParameter("from", str), OpenApiParameter("to", str), OpenApiParameter("branch", int)],
        responses={200: dict},
    )
    def get(self, request):
        period = queries.Period(
            parse_date(request.query_params.get("from"), "from"), parse_date(request.query_params.get("to"), "to")
        )
        branches = resolve_scope(request)
        key = (
            period.date_from.isoformat(),
            period.date_to.isoformat(),
            tuple(branches) if branches is not None else "all",
        )
        payload = core_cache.get_or_set("dashboard", key, CACHE_TTL, lambda: queries.dashboard(period, branches))
        return Response(payload)


class ReportListView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = "reports.read"

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response([{"key": k, "title": title} for k, (title, _) in queries.REPORTS.items()])


class ReportView(APIView):
    permission_classes = [IsAuthenticated, IsStaffUser, HasCapability]
    capability = "reports.read"

    @extend_schema(
        parameters=[
            OpenApiParameter("from", str),
            OpenApiParameter("to", str),
            OpenApiParameter("branch", int),
            OpenApiParameter("export", str),
        ],
        responses={200: dict},
    )
    def get(self, request, name):
        if name not in queries.REPORTS:
            raise DomainError(ErrorCode.NOT_FOUND, "Unknown report.", status_code=404)
        title, fn = queries.REPORTS[name]
        period = queries.Period(
            parse_date(request.query_params.get("from"), "from"), parse_date(request.query_params.get("to"), "to")
        )
        branches = resolve_scope(request)
        if request.query_params.get("export") == "csv":  # NB: not `format` — DRF reserves that for renderer selection
            if not user_has_capability(request.user, "reports.export"):
                raise DomainError(ErrorCode.FORBIDDEN, "You don't have permission to export reports.", status_code=403)
            data = fn(period, branches)
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow([c["label"] for c in data["columns"]])
            for row in data["rows"]:
                writer.writerow([csv_safe(row.get(c["key"], "")) for c in data["columns"]])
            audit.record(
                request.user,
                "report.exported",
                None,
                summary=f"{name} {period.date_from}…{period.date_to}",
                request=request,
                target_type="Report",
                target_id=name,
            )
            response = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
            response["Content-Disposition"] = f'attachment; filename="{name}-{period.date_from}-{period.date_to}.csv"'
            return response
        key = (
            name,
            period.date_from.isoformat(),
            period.date_to.isoformat(),
            tuple(branches) if branches is not None else "all",
        )
        data = core_cache.get_or_set("reports", key, CACHE_TTL, lambda: fn(period, branches))
        return Response({"key": name, "title": title, "period": period.as_dict(), **data})
