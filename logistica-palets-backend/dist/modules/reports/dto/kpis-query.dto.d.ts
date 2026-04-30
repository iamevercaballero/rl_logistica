declare const ranges: readonly ["today", "week", "month"];
export declare class KpisQueryDto {
    range?: (typeof ranges)[number];
}
export {};
