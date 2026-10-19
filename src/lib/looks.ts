/** Graphics art styles are drawn by the free motion-graphics engine instead of AI pictures. Safe in the browser. */
export const isGraphicsLook = (look?: string) => !!look && /motion[- ]graphics|infographic|title[- ]sequence|graphic/i.test(look) && !/photo|realis/i.test(look);
