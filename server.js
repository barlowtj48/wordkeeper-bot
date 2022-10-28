const fs = require("fs");
require("dotenv").config();
const { channel } = require("diagnostics_channel");

const { Client, GatewayIntentBits, Partials, Collection  } = require('discord.js');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds, 
		GatewayIntentBits.GuildMessages, 
		GatewayIntentBits.GuildPresences, 
		GatewayIntentBits.GuildMessageReactions, 
		GatewayIntentBits.DirectMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildVoiceStates
	], 
	partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember, Partials.Reaction] 
});

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const help_doc =
  "**Wordkeeper Commands:**\n" +
  "`!word` tells you the current hot word.\n" +
  "`!score` tells you your current score.\n" +
  "`!stats` tells you all of the data recorded about you.\n" +
  "`!leaderboard` updates you on who in the server has the highest score.\n" +
  "`!invite` gives an invite to this server.\n\n" +
  "**Channel Commands:**\n" +
  "`{word} gift @user [amount]` you can gift any user any amount.\n" +
  "`{word} bomb @user` will cost you 20. There's a 50/50 chance you'll set there score to 0, or set your own to 0 and be kicked!\n" +
  "`{word} change [new word]` costs 50. Will change the word to any word of your choice.\n" +
  "`{word} gamble [amount] on [1-5]` gives you a 1 in 5 chance of winning 5 times your bet.\n" +
  "`{word} gamble all on [1-5]` gives you a 2 in 5 chance of winning 10 times your bet.\n" + 
  "`{word} boot @user` costs 10. Will kick them from the server, however they will always be reinvited.\n" +
  "`{word} multiply [2-5]` will leave you with your amount divided by the multiplier you have entered. This multiplier will affect your score gains for 1 minute.";

var servers = [];

class User {
  constructor(id, username) {
    this.type = "User";
    this.id = id;
    this.username = username; //this is to make the stored data more readable
    this.messages_sent = 0;
    this.times_kicked = 0;
    this.hotword_change_counter = 0;
    this.score_multiplier = 1;
    this.rank = 0;
    this.score = 0;
  }
  at() {
    return `<@${this.id}>`;
  }
  add_score(amount) {
    this.score += amount * this.score_multiplier;
    if(this.score >= 999999999){
      this.score = 999999999;
    }
  }
  set_score(score) {
    this.score = score;
  }
  set_score_multiplier(multiplier) {
    this.score_multiplier = multiplier;
  }
  remove_score(amount) {
    if(this.score < amount) {
      this.score = 0;
      return;
    }
    this.score -= amount; 
  }
  hotword_sent() {
    this.messages_sent++;
  }
  hotword_changed() {
    this.hotword_change_counter++;
  }
  add_remove() {
    this.times_kicked++;
  }
  get_user() {
    return client.users.cache.get(this.id);
  }
}

class Server {
  constructor(m_id, m_channel_id, m_hotword) {
    this.type = "Server";
    this.id = m_id;
    this.word_channel_id = m_channel_id;
    this.invite_link = 'unassigned';
    this.hotword = m_hotword;
    this.users = [];
  }

  get_user_stats(user) {
    let printed_obj = [];
    printed_obj.push([`${user.username} Stats`, ""]);
    printed_obj.push(["Score", user.score.toString()]);
    printed_obj.push(["Hotwords Sent", user.messages_sent.toString()]);
    printed_obj.push([
      "Hotwords Changed",
      user.hotword_change_counter.toString()
    ]);
    printed_obj.push(["Rank", user.rank.toString()]);
    printed_obj.push(["Times Kicked", user.times_kicked.toString()]);
    return table_format(printed_obj);
  }
  get_leaderboard() {
    let printed_obj = [];
    this.users.sort(function(user_1, user_2) {
      return user_1.score < user_2.score ? 1 : -1;
    });
    let user_number = 1;
    for (let user of this.users) {
      if(user.score > 0){
        printed_obj.push([user.username.toString(), user.score.toString()]);
        user_number++;
      }
      if(table_format(printed_obj).length >= 2000){
        return table_format(printed_obj.slice(0,-1));
      }
    }
    return table_format(printed_obj);
  }
  async update_nickname(user) {
    let member = await this.get_member(user.id);
    let re = /\s*\(.*\d*\).*/g;
    let old_name = member.displayName;
    let new_name = old_name.replace(re, " (" + user.score + ")");
    if (new_name == old_name && !re.test(old_name)) {
      new_name = `${old_name} (${user.score})`;
    }
    try {
      await member.setNickname(new_name);
    } catch (error) {
      console.log(`Unable to change member username: ${user.username}`);
    }
  }
  get_user(user_id) {
    return this.users.find(user => user.id == user_id);
  }
  get_member(user_id) {
    let user = this.get_user(user_id);
    return this.get_guild().members.fetch(user.id);
  }
  get_guild() {
    return client.guilds.cache.get(this.id);
  }
  get_channel() {
    return client.channels.cache.get(this.word_channel_id);
  }
  change_channel_name(name) {
    this.get_channel().setName(name);
  }

  async create_invite() {
    let url = 'https://discord.gg/';
    let invite = await this.get_channel().createInvite({
      maxAge : 0 //only thing besides default settings is that it should last forever
    }).then((invite) => url += invite.code);
    this.invite_link = url;
    return;
  }

  populate_new_server(members) {
    for (let member of members) {
      member = member[1];
      if (member.user.bot) continue;
      let user = new User(member.id, member.user.username);
      this.users.push(user);
    }
  }

  update_all_nicknames() {
    for (let user of this.users) {
      this.update_nickname(user);      
    }
  }
  add_new_member(member) {
    if (member.user.bot) return;
    let user = new User(member.id, member.user.username);
    this.users.push(user);
    this.update_nickname(user);
  }
  hotword_sent(user, message, mentioned_user) {
    if (message.startsWith(this.hotword)) {
      const split_message = message.split(" ");
      switch (split_message[1]) {
        case "gamble":
          this.gamble(
            user,
            split_message[2], // could be "all"
            Math.round(Number(split_message[4]))
          );
          break;
        case "change":
          let new_word = message.substring(
            this.hotword.length + 8,
            message.length
          );
          this.change_hotword(user, new_word);
          user.hotword_changed();
          break;
        case "boot":
          this.boot(user, mentioned_user);
          break;
        case "gift":
          this.gift(user, mentioned_user, split_message[2], split_message[3]);
          break;
        case "multiply":
          this.multiply(user, split_message[2]);
          break;
        case "bomb":
          this.bomb(user, mentioned_user)
          break;
        default:
          user.add_score(1);
          break;
      }
      this.update_nickname(user);
    } else {
      user.add_score(1);
    }
  }
  command_sent(user, message) {
    message = message.substring(1, message.length);
    switch (message) {
      case "help":
        this.get_channel().send(help_doc);
        break;
      case "word":
        this.get_channel().send(`The word is \`${this.hotword}\`.`);
        break;
      case "score":
        this.get_channel().send(`${user.at()} : ${user.score}`);
        break;
      case "stats":
        this.get_channel().send(this.get_user_stats(user));
        break;
      case "leaderboard":
        this.get_channel().send(this.get_leaderboard());
        break;
      case "gamers":
        if(user.id == '140223433878274048') {
          return 'mcc_custom'
        } else {
          return 'delete_message';
        }
        
        break;
      // case "1000":
      //   user.add_score(1000);
      //   break;
      case "invite":
        this.get_channel().send(this.invite_link);
        break;
      default:
        return 'delete_message';
        break;
    }
  }
   
  async gamble(user, amount, number) {
    let channel = this.get_channel();
    if(user.score == 0) {
      user.add_score(1);
    }
    let response = bound_check(user, number, 1, 5);
    if (response != '') {
      channel.send(response);
      return;
    }
    if(isNaN(amount)) { //invalid number or "all"
      if(amount.toLowerCase() == "all") {
        let random1 = Math.floor(Math.random() * 5 + 1);
        let random2 = Math.floor(Math.random() * 5 + 1);
        while(random1 == random2) {
          random2 = Math.floor(Math.random() * 5 + 1);
        }
        if(number == random1 || number == random2) {
          channel.send(
            `${user.at()}: **WINNER!** You just won **${10 * user.score * user.score_multiplier}**!`
          );
          user.add_score(user.score * 10);
          return;
        } else {
          channel.send(
            `${user.at()}: **OUCH!** Looks like you've got no more to spare. The numbers were ${random1} and ${random2}.`
          );
          user.remove_score(user.score);
          return;
        }
      }
    } else {
      amount = Math.round(Number(amount));
    }
    response = afford_check(user, amount);
    if (response != '') {
      channel.send(response);
      return;
    }
    let random_number = Math.floor(Math.random() * 5 + 1);
    if (number == random_number) {
      user.add_score(amount * 5);
      channel.send(
        `${user.at()}: **WINNER!** You just won **${amount * 5 * user.score_multiplier}**!`
      );
    } else {
      user.remove_score(amount);
      channel.send(`${user.at()}: Too bad! The number was ${random_number}`);
    }
    return; 
  }

  async multiply(user, multiplier) {
    if(user.score == 0) {
      user.add_score(1);
      return;
    }
    if(user.score_multiplier != 1) {
      this.get_channel(`${user.at()} you are already powered up.`);
      return;
    }
    let response = bound_check(user, Number(multiplier), 2, 5);
    if(response != "") {
      this.get_channel().send(response);
    } else {
      let pre_score = user.score;
      user.set_score(Math.round(user.score / multiplier));
      user.set_score_multiplier(multiplier);
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute of multiplier
      let post_score = user.score;
      user.set_score_multiplier(1);
      let modifier = ""
      if(pre_score > post_score) {
        modifier = "lost";
      } else {
        modifier = "gained";
      }
      this.get_channel().send(`${user.at()} Your multiplier has ended.\n**You ${modifier} ${Math.abs(post_score-pre_score)}**.`);
    }
  }

  async bomb(user, mentioned_user) {
    let response = afford_check(user, 20);
    if (response != '') {
      this.get_channel().send(response);
      return;
    }

    let coin_flip = Math.random() < 0.5;

    if(coin_flip) {
      // Success!
      mentioned_user.set_score(0);
      response = `${mentioned_user.at()}: ${user.at()} has bombed you!`;
    } else {
      // It's blown up in your face
      user.set_score(0);
      this.self_bomb(user);
      response = `${user.at()} just accidentally bombed themselves!`;
    }
    this.get_channel().send(response);
  }

  gift(user, target_user, input_1, input_2) {
    if(user.score == 0) {
      user.add_score(1);
      return;
    }
    let amount;
    if(input_1.includes(target_user.id)) {
      amount = Math.round(Number(input_2));
    } else if(input_2.includes(target_user.id)) {
      amount = Math.round(Number(input_1));
    }
    let response = afford_check(user, amount);
    if (response === '') {
      user.remove_score(amount);
      target_user.add_score(amount / target_user.score_multiplier);
      response = `<@${user.id}> has gifted <@${target_user.id}> ${amount}.`;
      this.update_nickname(user);
      this.update_nickname(target_user);
    }
    this.get_channel().send(response);
  }

  async boot(user, target_user) {
    console.log("TAGGED USER:");
    console.log(target_user);
    if(!target_user) { //not a valid tag
      return;
    }
    if(this.get_member(target_user.id).bot) { //not allowed to tag the bot
      return;
    }
    let premium_user = false;
    await this.get_member(target_user.id).then(member => {
      if(member.roles.cache.find(role => role.name === "Server Booster")){
        premium_user = true;
      }
    })
    if(premium_user){
      await this.get_channel().send("Unable to remove a user that is boosting the server.");
      return;
    }
    if (user.score < 10) {
      this.get_channel().send(`You do not have enough boot ${target_user.username}.`);
      return;
    } else {
      user.remove_score(10);
    }
    target_user.add_remove();
    let rich_target_user = target_user.get_user();
    await rich_target_user.send(`Looks like you got booted by ${user.username}. Sorry about that, here's a link to rejoin.\n${this.invite_link}`).then(async () => {
      await this.get_member(rich_target_user.id).then(member => member.kick());
    })
  }
  async change_hotword(user, hotword) {
    let channel = this.get_channel();
    if (user.score < 50) {
      channel.send("You do not have enough to change the word.");
      return;
    } else {
      user.remove_score(50);
    }
    hotword = word_validate(hotword, this);
    await channel.setName(hotword).then((this.hotword = hotword));
    channel.send(`${user.at()} has changed the word to **\`${hotword}\`**.`);
  }
  async self_remove(user) {
    user.add_remove(); 
    user.remove_score(10);
    let rich_user = user.get_user();
    await rich_user.send(`It looks like that last message of yours didn't have \`${this.hotword}\` in it.\nMake sure you include the word in the correct channel!\nHere's an invite link: ${this.invite_link}`).then(async () => {
      await this.get_member(rich_user.id).then(member => member.kick());
    })
  }
  async self_bomb(user) {
    user.add_remove(); 
    let rich_user = user.get_user();
    await rich_user.send(`It looks like you tried to bomb someone, and it blew up in your face. Nice.\nHere's an invite link: ${this.invite_link}`).then(async () => {
      await this.get_member(rich_user.id).then(member => member.kick());
    })
  }
  async spam_remove(user) {
    user.add_remove(); 
    user.set_score(0);
    let rich_user = user.get_user();
    await rich_user.send(`Chill with the command documentation spam. Your score has been reset to 0.\nHere's an invite link: ${this.invite_link}`).then(async () => {
      await this.get_member(rich_user.id).then(member => member.kick());
    })
  }
}

client.on("messageCreate", async message => {
  if (message.author.bot) return; //later refresh name of tagged users
  if (!message.guild) {
    //the message is a DM
    console.log("DM received.");
    return;
  }
  
  // if(message.content.toLowerCase() == "reset") { //for debugging
  //     servers = [];
  //     write_data();
  //     return;
  //   }
  let server = servers.find(s => s.id == message.guild.id);
  if (server == null) {
    // if(message.content.toLowerCase() != "create") //for debugging
    //   return;
    server = new Server(message.guild.id, message.channel.id, "word");
    server.populate_new_server(message.guild.members.cache);
    server.update_all_nicknames();
    server.change_channel_name('word');
    await server.create_invite();
    server.get_channel().send(`New server established.`);
    servers.push(server);
    write_data();
    return;
  }
  //look for user
  let user = server.users.find(u => u.id == message.author.id);
  if(user == undefined) {
    new_member(message.member);
    user = server.users.find(u => u.id == message.author.id);
  }
  let id = message.author.id;
  let guild = message.guild;
  //in a server
  if (message.channel.id == server.word_channel_id) {
    //in the hotword channel, ignore others
    let spaced_hotword = server.hotword.replace(/-/g, " ");
    corrected_content = message.content.toLowerCase().replace(spaced_hotword, server.hotword);
    if (message.content.startsWith("!")) {
      await server.get_channel().messages.fetch({ limit: 10 }).then(messages => {
        let user_messages = messages.filter((m => m.author.id === user.id && m.content.includes('!')));
        if(user_messages.size >= 4){
          console.log(`MESSAGE BEING SPAMMED; REMOVING ${user.username}`);
          server.spam_remove(user);
          message.delete();
          write_data();
        }
      });
      let response = server.command_sent(user, message.content.toLowerCase());
      if(response == 'delete_message') {
        await message.delete();
      } else if(response == 'mcc_custom'){
        send_MCC_sound_message(message.channel, message);
      }
    } else if (corrected_content.startsWith(server.hotword)) {
      let mentioned_id = message.mentions.users.first();
      let mentioned;
      if(mentioned_id != null) {
        mentioned = server.get_user(mentioned_id);
      }
      server.hotword_sent(user, corrected_content, mentioned);
      user.hotword_sent();
      write_data();
    } else if (corrected_content.includes(server.hotword)) {
      user.add_score(1);
      user.hotword_sent();
      write_data();
    } 
    else {
      message.react("👎");
      if(message.member.roles.cache.find(role => role.name === "Server Booster")){
        await message.channel.send("Unable to remove a user that is boosting the server.");
      } else {
        server.self_remove(user);
        write_data();
      }
      
    }
  } else { //could be in one of the created text channels
    if(message.channel.id == channel.id) {
      if(message.content.startsWith("!")) {
        content = message.content.substring(1, message.content.length);
        if(content.toLowerCase() == "gamers"){
          send_MCC_sound_message(message.channel, message);
        }
      }
      write_data();
    }
  }
});

function new_member(member) {
  let server = servers.find(s => s.id == member.guild.id);
  if (server == null) {
    return;
  }
  let user = server.users.find(u => u.id == member.id);  
  if(user != null) {
    server.update_nickname(user);
    return
  }
  else {
    server.add_new_member(member);
  }
  return
}

client.on("voiceStateUpdate", async (oldState, newState) => {
  if(newState.member.user.bot) return;
  if(!newState.channelId) return;
  channelName = newState.channel.name
  if(channelName.toLowerCase() == "afk"){
    console.log(`Kicking ${oldState.member.user.username} for being afk.`)
    await newState.member.voice.disconnect();
  }
  return;
});

client.on("guildMemberAdd", member => { //member joins the server
  let server = servers.find(s => s.id == member.guild.id);
  if (server == null) {
    return;
  }
  let user = server.users.find(u => u.id == member.id);  
  if(user != null) {
    server.update_nickname(user);
    return
  }
  else {
    server.add_new_member(member);
  }
});

function read_data() {
  fs.readFile("./data.json", (err, data) => {
    let servers = [];
    console.log("Reading data...");
    if (err) {
      if (fs.existsSync("./data.json")) {
        console.log("Data unable to be read.");
      } else{
        fs.writeFile('data.json', '[]', function (err) {
          if (err) return console.log(err);
          console.log('data.json was created.');
          servers = [];
        });
      }
      
    } else if (JSON.parse(data) == undefined) {
      servers = [];
      console.log(JSON.stringify(servers, null, 2));
    } else {
      servers = JSON.parse(data);
      servers = to_object(servers);
    }
  });
}
function write_data() {
  fs.writeFile("data.json", JSON.stringify(servers, null, 2), err => {
    if (err) {
      console.log("Data was unable to be written.");
    } else {
      let d = new Date();
      console.log(
        d.getDate() +
          ":" +
          d.getHours() +
          ":" +
          d.getMinutes() +
          ":" +
          d.getSeconds() +
          ";   Data updated"
      );
    }
    //console.log(JSON.stringify(servers, null, 2));
  });
}

function bound_check(user, input, lower, upper) {
  if (isNaN(input)) {
    return `${user.at()} Please enter a valid number`;
  }
  if (isNaN(input) || input < lower || input > upper) {
    return `${user.at()} Please choose a number between ${lower} and ${upper}.`;
  }
  return '';
}

function afford_check(user, amount) {
  if (isNaN(amount)) {
    return `${user.at()} Please enter a valid number.`;
  }
  if (isNaN(amount) || amount < 0) {
    return `${user.at()} Please enter an amount more than 0.`;
  }
  if (amount > user.score) {
    return `${user.at()} You don't have that much to spend.`;
  }
  return '';
}

function word_validate(word, server) {  
  word = word.trim().toString();
  word = word.replace(/\s+/g, "-");
  word = word.replace(/^[#@!]/g, "")
  
  if (word.length > 32) {
    return word.substring(0, 32).trim();
  } else if (word == "") {
    return "space";
  } else if (word.startsWith('#')) {
    
  } else if(/\d{18}/g.test(word)) {
    //let user_id = word.substring(3, word.length-1);
    let id = word.match(/\d{18}/g) //fix me now
    let user = server.users.find(user => user.id == id);
    if(user != null) {
      word = word.replace(/<@!\d{18}>/g, user.username) //replace <@\d{18}> with username
    }
    let channel = server.get_guild().channels.cache.find(c => c.id == id);
    if(channel != null) {
      return channel.name;      
    } else if(server.word_channel_id == id) {
      return server.get_channel().name;
    }
  } else {
    return word.toString();
  }
  return word.toString();
}

//  ╭──────────────────────────────────────────────╮ //limit of monospace font on mobile
//  │1NameN1┊1KeyN1│ //44 characters of usable space
//  ╰──────────────────────────────────────────────╯


function table_format(items) {
  
  let output = "```╭───────────────────────────────────┬──────────╮\n";
  for (let item of items) {
    let key_whitespace = " ".repeat(34 - item[0].length);
    let value_whitespace = " ".repeat(9 - item[1].length);
    output += `│ ${item[0]}${key_whitespace}┊ ${item[1]}${value_whitespace}│\n`;
    if (item != items[items.length - 1]) {
      output += "├───────────────────────────────────┼──────────┤\n";
    }
  }
  output += "╰───────────────────────────────────┴──────────╯```";
  return output;
}


function to_object(s_servers) {
  //string json of servers, contains no rich object data
  let temp_servers = [];
  for (let s_server of s_servers) {
    let server = new Server(
      s_server.id,
      s_server.word_channel_id,
      s_server.hotword
    );
    server.invite_link = s_server.invite_link;
    let temp_users = [];
    for (let s_user of s_server.users) {
      let user = new User(s_user.id, s_user.username);
      user.messages_sent = s_user.messages_sent;
      user.times_kicked = s_user.times_kicked;
      user.hotword_change_counter = s_user.hotword_change_counter;
      user.score_multiplier = s_user.score_multiplier;
      user.rank = s_user.rank;
      user.score = s_user.score;
      temp_users.push(user);
    }
    server.users = temp_users;
    temp_servers.push(server);
  }
  servers = temp_servers;
}

async function send_MCC_sound_message(channel, message){
  output_dir = process.cwd();
  dir_choices = ["double_kill", "kill_pocolypse", "kill_tacular"]
  random_choice = Math.floor(Math.random() * 3);
  output_dir += `\\sounds\\${dir_choices[random_choice]}\\Attention All Gamers!.mp3`

  await message.delete();
  await channel.send("@everyone", {files : [ output_dir]});
}

client.on("ready", () => {
  servers = read_data();
  console.log(`Logged in as ${client.user.tag}!`);
});
client.login(TOKEN);