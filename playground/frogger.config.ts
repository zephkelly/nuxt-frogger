import { defineFroggerOptions } from '#frogger/config';



export default defineFroggerOptions({
    app: {
        name: 'uat2_cp_rrs',
        version: '1.0.0'
    },

    public: {
        endpoint: '/api/Logs',
        baseUrl: 'https://uat2.cp.rrs.com',
    },

    serverModule: true,
    clientModule: true,
});