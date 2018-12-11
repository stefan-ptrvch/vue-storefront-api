import resource from 'resource-router-middleware';
import { apiStatus } from '../lib/util';
import { merge } from 'lodash';

const Ajv = require('ajv'); // json validator
const kue = require('kue');
const jwa = require('jwa');
const hmac = jwa('HS256');

export default ({ config, db }) => resource({

    /** Property name to store preloaded entity on `request`. */
    id : 'order',

    /**
     * POST create an order with JSON payload compliant with models/order.md
     */
    create(req, res) {

        const ajv = new Ajv();
        const orderSchema = require('../models/order.schema.json')
        const orderSchemaExtension = require('../models/order.schema.extension.json')
        const validate = ajv.compile(merge(orderSchema, orderSchemaExtension));

        if (!validate(req.body)) { // schema validation of upcoming order
            console.dir(validate.errors);
            apiStatus(res, validate.errors, 500);
            return;
        }
        const incomingOrder = { title: 'Incoming order received on ' + new Date() + ' / ' + req.ip, ip: req.ip, agent: req.headers['user-agent'], receivedAt: new Date(), order: req.body  }/* parsed using bodyParser.json middleware */
        console.log(JSON.stringify(incomingOrder))

        // Get AdCombro API key, and order IDs
        var fs = require('fs');
        var adComboData = JSON.parse(fs.readFileSync('./config/adcombo.json', 'utf8'));

        // Extract all data from order, which is needed for sending AdCombo API
        // requests
        const products = incomingOrder.order.products
        const customerData = incomingOrder.order.addressInformation.shippingAddress
        const firstName = customerData.firstname
        const lastName = customerData.lastname
        const countryCode = customerData.country_id
        const phoneNumber = customerData.telephone
        const price = customerData.telephone

        for (let key in products) {
            // Construct API GET request object
            let requestObject = {
                api_key: adComboData.api_key,
                name: firstName + ' ' + lastName,
                phone: phoneNumber,
                offer_id: adComboData.offer_ids[products[key].sku],
                country_code: countryCode,
                base_url: "healthsworth.com/nl",
                price: products[key].price,
                referrer: "google.com",
                ip: req.headers['x-real-ip']
            }
            console.log('====================================================')
            console.log('Order number ' + key)
            console.log('====================================================')
            console.log(products[key].sku)
            var request = require('request');
            const url = 'https://api.adcombo.com/api/v2/order/create'
            fs.appendFileSync('./orders.json', JSON.stringify(requestObject));
            request({url:url, qs:requestObject},
                function(err, response, body) {
                    if(err) {
                        console.log(err)
                        return
                    }
                    console.log("Get response: " + response.statusCode)

                    // Log order to log file
                }
            )
        }

        for (let product of req.body.products) {
            let key = config.tax.calculateServerSide ? { priceInclTax: product.priceInclTax } : {  price: product.price }
            if (config.tax.alwaysSyncPlatformPricesOver) {
                key.id = product.id
            } else {
                key.sku = product.sku
            }
            // console.log(key)

            if (!config.tax.usePlatformTotals) {
                if (!hmac.verify(key, product.sgn, config.objHashSecret)) {
                    console.error('Invalid hash for ' + product.sku + ': ' + product.sgn)
                    apiStatus(res, "Invalid signature validation of " + product.sku, 200);
                    return;
                }
            }
        }

        try {
            let queue = kue.createQueue(Object.assign(config.kue, { redis: config.redis }));
            const job = queue.create('order', incomingOrder).save( function(err){
                if(err) {
                    console.error(err)
                    apiStatus(res, err, 500);
                } else {
                    apiStatus(res, job.id, 200);
                }
            })
        } catch (e) {
            apiStatus(res, e, 500);
        }
    },

});
