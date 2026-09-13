declare module "nodemailer" {
  const mail: {
    createTransport(url: string): {
      sendMail(message: {
        from: string;
        to: string;
        subject: string;
        text: string;
      }): Promise<unknown>;
    };
  };
  export default mail;
}
