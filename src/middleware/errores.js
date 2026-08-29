/** Error con código HTTP explícito para responder de forma controlada. */
export class ErrorHttp extends Error {
  constructor(estado, mensaje, detalles) {
    super(mensaje);
    this.name = 'ErrorHttp';
    this.estado = estado;
    this.detalles = detalles;
  }
}

/** 404 para rutas no registradas. */
export function noEncontrado(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

/** Manejador central de errores. Traduce errores de PostgreSQL frecuentes. */
export function manejadorErrores(err, req, res, _next) {
  if (err instanceof ErrorHttp) {
    return res.status(err.estado).json({ error: err.message, detalles: err.detalles });
  }

  switch (err.code) {
    case '23505': // unique_violation
      return res.status(409).json({ error: 'Ya existe un registro con ese valor', detalles: err.detail });
    case '23503': // foreign_key_violation
      return res.status(409).json({ error: 'Referencia inválida o registro en uso', detalles: err.detail });
    case '23514': // check_violation
      return res.status(400).json({ error: 'Dato fuera de rango permitido', detalles: err.detail });
    case '22P02': // invalid_text_representation
      return res.status(400).json({ error: 'Formato de dato inválido' });
    default:
      break;
  }

  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
}
