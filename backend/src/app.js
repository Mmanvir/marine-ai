const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const config = require('./config/env');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware');

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: false, exposedHeaders: ['Content-Disposition'] }));
if (!config.isTest) app.use(morgan('dev')); // request line only: no bodies, no auth headers
app.use(express.json({ limit: '1mb' }));

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
