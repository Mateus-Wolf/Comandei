class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        self.status, self.code, self.message = status, code, message
        self.details = details or {}
        super().__init__(message)


def conflict(code: str, message: str, **details):
    raise APIError(409, code, message, details)


def missing():
    raise APIError(404, "NOT_FOUND", "Recurso não encontrado.")


def forbidden():
    raise APIError(403, "FORBIDDEN", "Você não tem permissão para esta ação.")
