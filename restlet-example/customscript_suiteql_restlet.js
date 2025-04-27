/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */
define(['N/query'], (query) => {

    const post = (requestBody) => {
        try {
            const results = query.runSuiteQL({ query: requestBody.q }).asMappedResults();
            return { success: true, data: results };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    return { post };
});
