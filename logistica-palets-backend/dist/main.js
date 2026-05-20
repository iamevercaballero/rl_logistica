"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const common_1 = require("@nestjs/common");
const helmet_1 = __importDefault(require("helmet"));
async function bootstrap() {
    var _a;
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, helmet_1.default)());
    app.setGlobalPrefix('api');
    const corsOrigin = (_a = process.env.CORS_ORIGIN) === null || _a === void 0 ? void 0 : _a.trim();
    app.enableCors(corsOrigin
        ? { origin: corsOrigin.split(',').map((o) => o.trim()), credentials: true }
        : { origin: true, credentials: true });
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    const port = process.env.PORT || 3000;
    await app.listen(port);
    console.log(`Logistica palets API escuchando en puerto ${port}`);
}
void bootstrap();
//# sourceMappingURL=main.js.map