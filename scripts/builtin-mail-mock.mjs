// Only loaded explicitly by the MCP smoke test; no real account or mail server.
import assert from 'node:assert/strict';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
ImapFlow.prototype.connect = async function () {};
ImapFlow.prototype.getMailboxLock = async function (mailbox, options) {
  assert.equal(mailbox, 'INBOX'); assert.equal(options.readOnly, true);
  return { release() {} };
};
ImapFlow.prototype.search = async function (query, options) {
  assert.equal(query.text, 'invoice'); assert.equal(options.uid, true); return [11, 12];
};
ImapFlow.prototype.fetch = async function* (ids, query, options) {
  assert.deepEqual(ids, [12, 11]); assert.equal(options.uid, true);
  yield {uid:12,envelope:{subject:'Invoice 12'}};
  yield {uid:11,envelope:{subject:'Invoice 11'}};
};
ImapFlow.prototype.fetchOne = async function (uid, query, options) {
  assert.equal(uid, 12); assert.equal(options.uid, true); assert.equal(query.source.maxLength, 256000);
  return {uid:12,envelope:{subject:'Invoice 12'},source:Buffer.from('From: sender@example.com\r\nTo: user@example.com\r\nSubject: Invoice 12\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nInvoice amount: 1200.')};
};
ImapFlow.prototype.logout = async function () {};
nodemailer.createTransport = options => {
  assert.equal(options.secure, true); assert.equal(options.requireTLS, true);
  return {sendMail:async message=>{assert.deepEqual(message.to,['recipient@example.com']);assert.equal(message.text,'A test message');return {messageId:'mock-message',accepted:message.to};},close(){}};
};
