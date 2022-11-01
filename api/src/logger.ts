import { Request, RequestHandler } from 'express';
import pino, { LoggerOptions } from 'pino';
import pinoHTTP, { stdSerializers } from 'pino-http';
import { getConfigFromEnv } from './utils/get-config-from-env';
import { URL } from 'url';
import env from './env';
import { toArray } from '@directus/shared/utils';
import { merge } from 'lodash';

const pinoOptions: LoggerOptions = {
	level: env.LOG_LEVEL || 'info',
	redact: {
		paths: ['req.headers.authorization', `req.cookies.${env.REFRESH_TOKEN_COOKIE_NAME}`],
		censor: '--redact--',
	},
};

if (env.LOG_STYLE !== 'raw') {
	pinoOptions.transport = {
		target: 'pino-http-print',
		options: {
			all: true,
			translateTime: 'SYS:HH:MM:ss',
			relativeUrl: true,
		},
	};
}

const loggerEnvConfig = getConfigFromEnv('LOGGER_', 'LOGGER_HTTP');

// Expose custom log levels into formatter function
if (loggerEnvConfig.levels) {
	const customLogLevels: { [key: string]: string } = {};

	for (const el of toArray(loggerEnvConfig.levels)) {
		const key_val = el.split(':');
		customLogLevels[key_val[0].trim()] = key_val[1].trim();
	}

	pinoOptions.formatters = {
		level(label: string, number: any) {
			return {
				severity: customLogLevels[label] || 'info',
				level: number,
			};
		},
	};

	delete loggerEnvConfig.levels;
}

const logger = pino(merge(pinoOptions, loggerEnvConfig));

const httpLoggerEnvConfig = getConfigFromEnv('LOGGER_HTTP', ['LOGGER_HTTP_LOGGER']);

export const expressLogger = pinoHTTP({
	logger,
	...httpLoggerEnvConfig,
	serializers: {
		req(request: Request) {
			const output = stdSerializers.req(request);
			output.url = redactQuery(output.url);
			return output;
		},
	},
}) as RequestHandler;

export default logger;

function redactQuery(originalPath: string) {
	const url = new URL(originalPath, 'http://example.com/');

	if (url.searchParams.has('access_token')) {
		url.searchParams.set('access_token', '--redacted--');
	}

	return url.pathname + url.search;
}

// edited by @7macex1d
// add file logger by log4js, as follow:
import path from 'path';
import log4js from 'log4js';
import express from 'express';
let log4jsHTTPLogger: log4js.Logger;
export class FileLogger {
	static initLog4js(): boolean {
		const logRoot = loggerEnvConfig.destinationRoot
			? loggerEnvConfig.destinationRoot.startsWith('/')
				? (loggerEnvConfig.destinationRoot as string)
				: process.cwd()
				? process.cwd() + `/${loggerEnvConfig.destinationRoot}`
				: ''
			: '';
		if (!logRoot) return false;

		const httpLogFile = path.resolve(logRoot + '/v1/http.log');

		log4js.configure({
			appenders: {
				console: { type: 'console' },
				http: {
					type: 'file',
					filename: httpLogFile,
					layout: {
						type: 'pattern',
						pattern: '[%d{yyyy-MM-ddThh:mm:ss.SSS}] [%p] %c - [%h - PID:%z] --- %m',
					},
					alwaysIncludePattern: true,
					pattern: 'yyyy-MM-dd',
					daysTokeep: 7,
					backups: 3,
					keepFileExt: true,
				},
			},
			categories: {
				default: { appenders: ['console'], level: 'info' },
				http: { appenders: ['http'], level: 'all' },
			},
		});

		log4jsHTTPLogger = log4js.getLogger('http');
		return !!log4jsHTTPLogger;
	}

	static getHttpLogger(): express.Handler | undefined {
		if (!log4jsHTTPLogger) return undefined;

		// parse regex
		// \[([^]]+)] \[(\w+)] (\w+) - \[(\S+) - PID:(\d+)] --- (\S+) (\S+) - (\d+)ms - "(\S+) (\d+) (\w+) ([^"]+)" "([^"]*)" "([^"]*)"
		return log4js.connectLogger(log4jsHTTPLogger, {
			level: 'auto',
			statusRules: [
				{ from: 200, to: 399, level: 'info' },
				{ from: 400, to: 599, level: 'error' },
			],
			// include the Express request ID in the logs
			format: (req: express.Request, res: express.Response, format) => {
				const apiModule = (
					req.originalUrl.split('//').length <= 1 ? req.originalUrl.split('/')[1] : req.originalUrl.split('/')[2]
				).split('?')[0];
				const currentUser = ''; // TODO!
				return format(
					[
						// eslint-disable-next-line prettier/prettier
						':remote-addr',
						currentUser || ':remote-user',
						'-',
						':response-timems',
						'-',
						apiModule || '',
						'"HTTP/:http-version :status :method :url"',
						'":referrer"',
						'":user-agent"',
					].join(' ')
				);
			},
			nolog: '\\.(ico|gif|jpe?g|png|svg|woff2?|otf|ttf)',
		});
	}
}
