import { defineFroggerWebSocketHandler } from "../../../src/runtime/websocket/handler";

export default defineFroggerWebSocketHandler({
    upgrade(request) {
        console.log("WebSocket upgrade request received", request);
        return true;
    }
});