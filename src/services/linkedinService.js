const axios = require('axios');

class LinkedInService {
  constructor() {
    this.accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
    this.userId = process.env.LINKEDIN_USER_ID;
  }

  getConfig() {
    const accessToken = process.env.LINKEDIN_ACCESS_TOKEN || this.accessToken;
    const userId = process.env.LINKEDIN_USER_ID || this.userId;
    return { accessToken, userId };
  }

  async postToLinkedIn(content, imageUrl = null, hashtags = []) {
    try {
      const { accessToken, userId } = this.getConfig();

      if (!accessToken) {
        throw new Error('LinkedIn access token not configured');
      }
      if (!userId) {
        throw new Error('LinkedIn user id not configured');
      }

      console.log('📤 Preparing LinkedIn post...');
      console.log(`Content length: ${content.length} chars`);
      console.log(`Hashtags: ${hashtags.join(', ')}`);

      const postData = {
        author: `urn:li:person:${userId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: {
              text: content
            },
            shareMediaCategory: 'NONE'
          }
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC'
        }
      };

      if (imageUrl && !imageUrl.includes('placehold.co')) {
        try {
          console.log('🖼️ Uploading image to LinkedIn...');
          const asset = await this.uploadImage(imageUrl);
          if (asset) {
            postData.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'IMAGE';
            postData.specificContent['com.linkedin.ugc.ShareContent'].media = [asset];
            console.log('✅ Image uploaded successfully');
          }
        } catch (imageError) {
          console.log('⚠️ Image upload failed, posting without image');
        }
      }

      // Make the API call to post
      const response = await axios.post(
        'https://api.linkedin.com/v2/ugcPosts',
        postData,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('✅ LinkedIn post successful!');

      const postId = response.data.id;
      // LinkedIn returns URNs like `urn:li:share:...` or `urn:li:ugcPost:...`
      // A workable permalink format is `/feed/update/{urn}/`
      const postUrl = postId
        ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`
        : undefined;
      return {
        success: true,
        postId,
        postUrl,
        message: 'Post published to LinkedIn'
      };

    } catch (error) {
      console.error('❌ LinkedIn post error:', error.response?.data || error.message);
      throw error;
    }
  }

  async deletePost(postId) {
    try {
      const { accessToken } = this.getConfig();
      if (!accessToken) throw new Error('LinkedIn access token not configured');
      if (!postId) throw new Error('LinkedIn post id missing');

      const encoded = encodeURIComponent(String(postId));
      console.log(`🗑️ Deleting LinkedIn post: ${postId}`);
      await axios.delete(`https://api.linkedin.com/v2/ugcPosts/${encoded}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });

      return { success: true };
    } catch (error) {
      console.error(
        '❌ LinkedIn delete error:',
        error.response?.status,
        error.response?.data || error.message
      );
      throw error;
    }
  }

  async uploadImage(imageUrl) {
    try {
      const { accessToken, userId } = this.getConfig();
      if (!accessToken || !userId) return null;

      // Download image
      const imageResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      });

      const imageBuffer = Buffer.from(imageResponse.data);
      const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';

      // Register upload
      const registerResponse = await axios.post(
        'https://api.linkedin.com/v2/assets?action=registerUpload',
        {
          registerUploadRequest: {
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            owner: `urn:li:person:${userId}`,
            serviceRelationships: [
              {
                relationshipType: 'OWNER',
                identifier: 'urn:li:userGeneratedContent'
              }
            ]
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const uploadUrl = registerResponse.data.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
      const asset = registerResponse.data.value.asset;

      // Upload image
      await axios.put(uploadUrl, imageBuffer, {
        headers: {
          'Content-Type': mimeType
        }
      });

      return {
        status: 'READY',
        media: asset
      };
    } catch (error) {
      console.error('Error uploading image:', error.message);
      return null;
    }
  }

  async validateToken() {
    try {
      const { accessToken } = this.getConfig();
      const response = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      return { valid: true, userId: response.data.sub };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }
}

module.exports = new LinkedInService();