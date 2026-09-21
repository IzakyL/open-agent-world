from fastapi import APIRouter, Depends

from backend.api.dependencies import get_services
from backend.node_resources import ResourceActionRequest, invoke_resource_action
from backend.services import ApplicationServices

router = APIRouter(prefix="/nodes", tags=["node-resources"])


@router.post("/{node_id}/resource/{action}")
async def action(node_id: str, action: str, request: ResourceActionRequest,
                 services: ApplicationServices = Depends(get_services)):
    return await invoke_resource_action(services, node_id, action, request)
