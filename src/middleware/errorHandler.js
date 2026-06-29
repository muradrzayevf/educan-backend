export const notFound = (req, res) => {
  res.status(404).json({ error: 'Resurs tapılmadı.' });
};

export const errorHandler = (err, req, res, next) => {
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({
    error: err.isOperational ? err.message : 'Daxili server xətası baş verdi.',
  });
};
