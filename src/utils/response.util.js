// utils/response.util.js
export function successResponse(reply, data = null, message = "Success", code = 200) {
  return reply.code(code).send({
    success: true,
    message,
    data,
  });
}

export function errorResponse(reply, message = "Something went wrong", code = 500, error = null) {
  return reply.code(code).send({
    success: false,
    message,
    error: error?.message || undefined,
  });
}
