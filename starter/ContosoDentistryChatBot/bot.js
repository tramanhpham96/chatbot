// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityHandler, MessageFactory } = require('botbuilder');
const fetch = require("node-fetch");
const { CustomQuestionAnswering } = require('botbuilder-ai');
const DentistScheduler = require('./dentistscheduler');
const IntentRecognizer = require("./intentrecognizer")

class DentaBot extends ActivityHandler {
    constructor(configuration, qnaOptions) {
        // call the parent constructor
        super();
        this.body = {
            kind: "Conversation",
            analysisInput: {
                conversationItem: {
                    id: "123",
                    text: "",
                    modality: "text",
                    language: "en",
                    participantId: "123"
                }
            },
            parameters: {
                projectName: configuration.LuisConfiguration.applicationId,
                verbose: true,
                deploymentName: configuration.LuisConfiguration.deploymentId,
                stringIndexType: "TextElement_V8"
            }
        }
        this.apiUrl = configuration.LuisConfiguration.endpoint.concat("/language/:analyze-conversations?api-version=2022-10-01-preview");
        this.requestOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': configuration.LuisConfiguration.endpointKey,
                'Apim-Request-Id': '4ffcac1c-b2fc-48ba-bd6d-b69d9942995a'
            },
            body: "",
        };
        if (!configuration) throw new Error('[QnaMakerBot]: Missing parameter. configuration is required');

        // create a QnAMaker connector
        this.QnAMaker = new CustomQuestionAnswering(configuration.QnAConfiguration)
        // // create a DentistScheduler connector
        this.dentistScheduler = new DentistScheduler(configuration.SchedulerConfiguration)

        // // create a IntentRecognizer connector
        this.intentRecognizer = new IntentRecognizer(configuration.LuisConfiguration, qnaOptions);

        this.analyzeText = async function (text) {
            var t = {...this.body}
            t.analysisInput.conversationItem.text = text
            this.requestOptions.body = JSON.stringify(t)
            const response = await fetch(this.apiUrl, this.requestOptions);
            var data = await response.json();
            return data
        }
        
        this.onMessage(async (context, next) => {
            // send user input to QnA Maker and collect the response in a variable
            // don't forget to use the 'await' keyword
            const qnaResults = await this.QnAMaker.getAnswers(context)
            // // send user input to IntentRecognizer and collect the response in a variable
            // // don't forget 'await'
            // const LuisResults = await this.intentRecognizer.executeLuisQuery(context)
            const LuisResults = await this.analyzeText(context.activity.text)
            LuisResults.result.prediction.intents.sort(function(a, b) { 
                return b.confidenceScore - a.confidenceScore;})
            
            LuisResults.result.prediction.entities.length > 0
            // // determine which service to respond with based on the results from LUIS //
            if (LuisResults.result.prediction.intents[0].category == "GetAvailability" &&
            LuisResults.result.prediction.intents[0].confidenceScore > 0.5){
                const text = await this.dentistScheduler.getAvailability()
                await context.sendActivity(text);
                await next();
                return;
            }
            else if (LuisResults.result.prediction.intents[0].category == "ScheduleAppointment" &&
            LuisResults.result.prediction.intents[0].confidenceScore > 0.5 &&
            LuisResults.result.prediction.entities.length > 0){
                const date_time = LuisResults.result.prediction.entities[0].text;
                const text = await this.dentistScheduler.scheduleAppointment(date_time)
                await context.sendActivity(text);
                await next();
                return;
            }
            if (qnaResults[0]) {
                await context.sendActivity(`${qnaResults[0].answer}`);
            }
            // else {
            //     // If no answers were returned from QnA Maker, reply with help.
                // await context.sendActivity("I'm not sure I can answer your question");
            // }
            await next();
    });

        this.onMembersAdded(async (context, next) => {
        const membersAdded = context.activity.membersAdded;
        //write a custom greeting
        const welcomeText = 'Welcome to my clinic';
        for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
            if (membersAdded[cnt].id !== context.activity.recipient.id) {
                await context.sendActivity(MessageFactory.text(welcomeText, welcomeText));
            }
        }
        // by calling next() you ensure that the next BotHandler is run.
        await next();
    });
    }
}

module.exports.DentaBot = DentaBot;
