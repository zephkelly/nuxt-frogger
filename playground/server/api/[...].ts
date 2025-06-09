//catch all route to return 404
export default defineEventHandler((event) => {
    console.log('Catch all route hit');
    setResponseStatus(event, 404);
    return { message: 'Not Found' };
});